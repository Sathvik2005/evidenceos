import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RetrievedDocument, SearchProvider } from '../../src/agents/researchAgent'
import { createInvestigation } from '../../src/api/operations'
import { runInvestigationWorkflow } from '../../src/workflow/run'
import { WorkflowError } from '../../src/workflow/types'
import { fixtureLlm } from '../helpers/fixtureLlm'
import { createMigratedDatabase } from '../helpers/migratedDb'

let pg: PGlite

beforeAll(async () => {
  pg = await createMigratedDatabase()
})
afterAll(async () => {
  await pg.close()
})

const doc = (slug: string, text: string): RetrievedDocument => ({
  url: `https://example.org/${slug}`, title: `Source ${slug}`, sourceType: 'JOURNAL_ARTICLE', publisher: 'Example Journal',
  publishedAt: '2022-05-01T00:00:00.000Z', retrievedAt: '2026-01-01T00:00:00.000Z', text,
})

/** Controlled fixture corpus keyed by a word in the claim. */
const corpus: SearchProvider = {
  async search(query) {
    if (query.includes('test scores')) {
      return { documents: [doc('scores-up', 'Remote students improved reading scores in one district.'), doc('scores-down', 'Average math scores declined after the move to remote learning.')] }
    }
    if (query.includes('attendance')) return { documents: [doc('attendance', 'Remote students improved attendance rates in rural schools.')] }
    return { documents: [] } // wellbeing: nothing retrievable
  },
}

async function newInvestigation(owner: string, question = 'Does remote learning improve student outcomes?') {
  const result = await createInvestigation(pg, owner, { question })
  if (!result.ok) throw new Error('fixture setup failed')
  return result.data.id
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pg.query<{ n: string }>(sql, params)
  return Number(rows[0]?.n ?? 0)
}

const twoClaims = ['Remote learning changes standardized test scores', 'Remote learning changes student attendance rates']

describe('full investigation workflow (controlled fixture)', () => {
  it('runs end to end, preserves contradiction and records real state history', async () => {
    const investigationId = await newInvestigation('owner-a')
    const result = await runInvestigationWorkflow(
      { db: pg, llm: fixtureLlm({ claims: twoClaims }), search: corpus },
      { investigationId, ownerId: 'owner-a', question: 'ignored: loaded from the database' },
    )

    expect(result.status).toBe('COMPLETED')
    const { rows: claims } = await pg.query<{ statement: string; state: string | null; confidence: string | null }>(
      'SELECT statement, state, confidence FROM claims WHERE investigation_id = $1 ORDER BY ordinal', [investigationId])
    expect(claims.map((c) => c.state)).toEqual(['CONFLICTING', 'SUPPORTED'])
    expect(claims.every((c) => c.confidence === 'MEDIUM')).toBe(true)

    // The contradicting evidence is persisted next to the supporting evidence, with provenance.
    expect(await count("SELECT count(*) n FROM evidence WHERE investigation_id = $1 AND relationship = 'CONTRADICTS'", [investigationId])).toBe(1)
    expect(await count('SELECT count(*) n FROM sources WHERE investigation_id = $1', [investigationId])).toBe(3)
    // First assessments are stored directly: they are not state changes, so there is no history yet.
    expect(await count('SELECT count(*) n FROM evidence_changes WHERE investigation_id = $1', [investigationId])).toBe(0)
    const { rows } = await pg.query<{ status: string }>('SELECT status FROM investigations WHERE id = $1', [investigationId])
    expect(rows[0]?.status).toBe('READY')
    expect(result.summary).toContain('1 CONFLICTING')
  })

  it('is idempotent: a re-run creates no duplicate claims, evidence or history', async () => {
    const investigationId = await newInvestigation('owner-b')
    const deps = { db: pg, llm: fixtureLlm({ claims: twoClaims }), search: corpus }
    const input = { investigationId, ownerId: 'owner-b', question: '' }
    await runInvestigationWorkflow(deps, input)
    const before = await Promise.all(['claims', 'sources', 'evidence', 'evidence_changes'].map((t) => count(`SELECT count(*) n FROM ${t} WHERE investigation_id = $1`, [investigationId])))
    const again = await runInvestigationWorkflow(deps, { ...input })
    const after = await Promise.all(['claims', 'sources', 'evidence', 'evidence_changes'].map((t) => count(`SELECT count(*) n FROM ${t} WHERE investigation_id = $1`, [investigationId])))
    expect(after).toEqual(before)
    expect(again.status).toBe('COMPLETED')
  })

  it('never marks a claim supported without valid evidence; no evidence yields INSUFFICIENT', async () => {
    const investigationId = await newInvestigation('owner-c')
    const result = await runInvestigationWorkflow(
      { db: pg, llm: fixtureLlm(), search: corpus },
      { investigationId, ownerId: 'owner-c', question: '' },
    )
    expect(result.status).toBe('COMPLETED')
    expect(await count(
      `SELECT count(*) n FROM claims c WHERE investigation_id = $1 AND state = 'SUPPORTED'
       AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.claim_id = c.id AND e.relationship = 'SUPPORTS')`, [investigationId])).toBe(0)
    const { rows } = await pg.query<{ status: string; state: string | null; confidence: string | null }>(
      `SELECT i.status, (SELECT state FROM claims WHERE investigation_id = i.id AND ordinal = 3) AS state, (SELECT confidence FROM claims WHERE investigation_id = i.id AND ordinal = 3) AS confidence FROM investigations i WHERE id = $1`, [investigationId])
    expect(rows[0]).toEqual({ status: 'READY', state: 'INSUFFICIENT', confidence: 'LOW' })
  })
})

describe('change detection: new evidence changes a claim state', () => {
  const partlyDoc = doc('scores-partly', 'Remote students partly improved reading scores in one district.')
  const contradictingDoc = doc('scores-down', 'Average math scores declined after the move to remote learning.')

  it('PARTIALLY_SUPPORTED -> new evidence -> CONFLICTING, recorded once with its trigger', async () => {
    const investigationId = await newInvestigation('owner-h')
    let phase = 1
    const evolving: SearchProvider = {
      async search(query) {
        if (!query.includes('test scores')) return { documents: [] }
        return { documents: phase === 1 ? [partlyDoc] : [partlyDoc, contradictingDoc] }
      },
    }
    const deps = { db: pg, llm: fixtureLlm({ claims: [twoClaims[0] as string] }), search: evolving }
    const input = { investigationId, ownerId: 'owner-h', question: '' }
    const stateOf = async () => (await pg.query<{ state: string }>('SELECT state FROM claims WHERE investigation_id = $1', [investigationId])).rows[0]?.state

    await runInvestigationWorkflow(deps, input)
    expect(await stateOf()).toBe('PARTIALLY_SUPPORTED')
    expect(await count('SELECT count(*) n FROM evidence_changes WHERE investigation_id = $1', [investigationId])).toBe(0)

    phase = 2
    const second = await runInvestigationWorkflow(deps, input)
    expect(second.status).toBe('COMPLETED')
    expect(await stateOf()).toBe('CONFLICTING')
    const { rows } = await pg.query<{ previous_state: string; new_state: string; relationship: string; excerpt: string }>(
      `SELECT ch.previous_state, ch.new_state, e.relationship, e.excerpt FROM evidence_changes ch
       JOIN evidence e ON e.id = ch.triggering_evidence_id WHERE ch.investigation_id = $1`, [investigationId])
    expect(rows).toEqual([{ previous_state: 'PARTIALLY_SUPPORTED', new_state: 'CONFLICTING', relationship: 'CONTRADICTS', excerpt: contradictingDoc.text }])
    // The earlier evidence is kept; nothing is deleted because the state changed.
    expect(await count('SELECT count(*) n FROM evidence WHERE investigation_id = $1', [investigationId])).toBe(2)

    await runInvestigationWorkflow(deps, input) // same evidence again: no change, no new history
    expect(await count('SELECT count(*) n FROM evidence_changes WHERE investigation_id = $1', [investigationId])).toBe(1)
  })
})

describe('workflow failure handling', () => {
  it('keeps partial progress and marks research as unavailable when retrieval fails', async () => {
    const investigationId = await newInvestigation('owner-d')
    const offline: SearchProvider = { async search() { throw new WorkflowError('NETWORK', 'offline') } }
    const result = await runInvestigationWorkflow(
      { db: pg, llm: fixtureLlm({ claims: twoClaims }), search: offline, maxRetries: 1 },
      { investigationId, ownerId: 'owner-d', question: '' },
    )
    expect(result.status).toBe('PARTIAL')
    expect(result.failures.filter((f) => f.message.startsWith('Research unavailable'))).toHaveLength(2)
    expect(await count('SELECT count(*) n FROM claims WHERE investigation_id = $1', [investigationId])).toBe(2)
    expect(await count('SELECT count(*) n FROM claims WHERE investigation_id = $1 AND state IS NOT NULL', [investigationId])).toBe(0)
    expect(Object.keys(result.outcomes)).toHaveLength(0)
  })

  it('rejects a fabricated quote from the model without discarding the other claims', async () => {
    const investigationId = await newInvestigation('owner-e')
    const llm = fixtureLlm({
      claims: twoClaims,
      research: (request) =>
        request.user.includes('attendance')
          ? { candidates: [{ documentIndex: 0, excerpt: 'Invented attendance statistic.', relationship: 'SUPPORTS', strength: 'STRONG' }] }
          : undefined,
    })
    // Fall back to the default answer for the non-attendance claim.
    const wrapped = { ...llm, async generate(request: Parameters<typeof llm.generate>[0]) {
      if (request.schemaName === 'research_candidates' && !request.user.includes('attendance')) {
        return { candidates: [...request.user.matchAll(/<document index="(\d+)">\n([\s\S]*?)\n<\/document>/g)].map((m) => ({ documentIndex: Number(m[1]), excerpt: m[2], relationship: /declined/.test(m[2] ?? '') ? 'CONTRADICTS' : 'SUPPORTS', strength: 'MODERATE' })) }
      }
      return llm.generate(request)
    } }
    const result = await runInvestigationWorkflow(
      { db: pg, llm: wrapped, search: corpus, maxRetries: 1 },
      { investigationId, ownerId: 'owner-e', question: '' },
    )
    expect(result.status).toBe('PARTIAL')
    expect(result.failures.some((f) => f.node === 'research' && f.kind === 'MALFORMED_OUTPUT')).toBe(true)
    expect(await count("SELECT count(*) n FROM evidence WHERE investigation_id = $1 AND excerpt LIKE 'Invented%'", [investigationId])).toBe(0)
    expect(await count("SELECT count(*) n FROM claims WHERE investigation_id = $1 AND state = 'CONFLICTING'", [investigationId])).toBe(1)
  })

  it('fails the run explicitly on an authentication error and persists ERROR', async () => {
    const investigationId = await newInvestigation('owner-f')
    const denied = { async generate(): Promise<never> { throw new WorkflowError('AUTHENTICATION', 'bad key') } }
    const result = await runInvestigationWorkflow(
      { db: pg, llm: denied, search: corpus },
      { investigationId, ownerId: 'owner-f', question: '' },
    )
    expect(result.status).toBe('FAILED')
    expect(result.failures[0]).toMatchObject({ node: 'decompose', kind: 'AUTHENTICATION' })
    const { rows } = await pg.query<{ status: string }>('SELECT status FROM investigations WHERE id = $1', [investigationId])
    expect(rows[0]?.status).toBe('ERROR')
  })

  it('refuses to run for an investigation owned by someone else', async () => {
    const investigationId = await newInvestigation('owner-g')
    const result = await runInvestigationWorkflow(
      { db: pg, llm: fixtureLlm(), search: corpus },
      { investigationId, ownerId: 'intruder', question: '' },
    )
    expect(result.status).toBe('FAILED')
    expect(result.failures[0]).toMatchObject({ node: 'load', kind: 'AUTHORIZATION' })
  })
})
