// Failure injection (Prompt 19). Each case breaks one thing and proves the system fails safely:
// no false SUPPORTED, no hidden contradiction, no duplicate writes, and an explicit user-visible status.
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { researchClaim, type RetrievedDocument, type SearchProvider } from '../../src/agents/researchAgent'
import { createInvestigation, type Database } from '../../src/api/operations'
import { runInvestigationWorkflow } from '../../src/workflow/run'
import { WorkflowError } from '../../src/workflow/types'
import { DEFAULT_CLAIMS, fixtureLlm } from '../helpers/fixtureLlm'
import { createMigratedDatabase } from '../helpers/migratedDb'
import { scriptedLlm } from '../helpers/scriptedLlm'

let pg: PGlite
beforeAll(async () => {
  pg = await createMigratedDatabase()
})
afterAll(async () => {
  await pg.close()
})

const doc = (slug: string, text: string): RetrievedDocument => ({
  url: `https://example.org/${slug}`, title: `Source ${slug}`, sourceType: 'JOURNAL_ARTICLE', publisher: null,
  publishedAt: null, retrievedAt: '2026-01-01T00:00:00.000Z', text,
})
const corpus: SearchProvider = {
  async search(query) {
    return query.includes('test scores')
      ? { documents: [doc('up', 'Remote students improved reading scores in one district.'), doc('down', 'Average math scores declined after the move to remote learning.')] }
      : { documents: [] }
  },
}
const oneClaim = [DEFAULT_CLAIMS[0]]

async function investigation(owner: string) {
  const r = await createInvestigation(pg, owner, { question: 'Does remote learning improve student outcomes?' })
  if (!r.ok) throw new Error('setup failed')
  return r.data.id
}
const count = async (sql: string, params: unknown[]) => Number((await pg.query<{ n: string }>(sql, params)).rows[0]?.n ?? 0)
const run = (id: string, owner: string, extra: Partial<Parameters<typeof runInvestigationWorkflow>[0]> = {}) =>
  runInvestigationWorkflow({ db: pg, llm: fixtureLlm({ claims: oneClaim }), search: corpus, maxRetries: 2, ...extra }, { investigationId: id, ownerId: owner, question: '' })

describe('failure injection', () => {
  it('[HARD][FAILURE] timeout: recovers within the retry bound, then reports UNAVAILABLE, never a state', async () => {
    let calls = 0
    const flaky: SearchProvider = { async search(q) { calls += 1; if (calls < 3) throw new WorkflowError('TIMEOUT', 'slow'); return corpus.search(q) } }
    const id = await investigation('f-timeout')
    expect((await run(id, 'f-timeout', { search: flaky })).status).toBe('COMPLETED')
    expect(calls).toBe(3)

    let always = 0
    const dead: SearchProvider = { async search() { always += 1; throw new WorkflowError('TIMEOUT', 'slow') } }
    const other = await investigation('f-timeout')
    const result = await run(other, 'f-timeout', { search: dead })
    expect(always).toBe(3)
    expect(result.status).toBe('PARTIAL')
    expect(await count('SELECT count(*) n FROM claims WHERE investigation_id = $1 AND state IS NOT NULL', [other])).toBe(0)
  })

  it('[HARD][FAILURE] malformed model output: bounded retries, explicit failure, nothing persisted as evidence', async () => {
    const llm = fixtureLlm({ claims: oneClaim, research: () => ({ nonsense: true }) })
    const id = await investigation('f-malformed')
    const result = await run(id, 'f-malformed', { llm })
    expect(result.failures.some((f) => f.node === 'research' && f.kind === 'MALFORMED_OUTPUT')).toBe(true)
    expect(await count('SELECT count(*) n FROM evidence WHERE investigation_id = $1', [id])).toBe(0)
    expect(await count("SELECT count(*) n FROM claims WHERE investigation_id = $1 AND state = 'SUPPORTED'", [id])).toBe(0)
  })

  it('[HARD][FAILURE] missing excerpt: a candidate with no quote is rejected by the agent', async () => {
    const llm = scriptedLlm({ candidates: [{ documentIndex: 0, excerpt: '   ', relationship: 'SUPPORTS', strength: 'STRONG' }] })
    await expect(researchClaim({ llm, search: corpus }, { id: 'c', statement: 'test scores' }, { maxRetries: 0 })).rejects.toMatchObject({ kind: 'MALFORMED_OUTPUT' })
  })

  it('[HARD][FAILURE] fabricated provenance: an invented quote never reaches the database', async () => {
    const llm = fixtureLlm({ claims: oneClaim, research: () => ({ candidates: [{ documentIndex: 0, excerpt: 'Scores rose forty points everywhere.', relationship: 'SUPPORTS', strength: 'STRONG' }] }) })
    const id = await investigation('f-fabricated')
    await run(id, 'f-fabricated', { llm })
    expect(await count("SELECT count(*) n FROM evidence WHERE investigation_id = $1 AND excerpt LIKE '%forty%'", [id])).toBe(0)
  })

  it('[HARD][FAILURE] invalid claim reference: an assessment citing unknown evidence is rejected, not saved', async () => {
    const base = fixtureLlm({ claims: oneClaim })
    const llm = { ...base, async generate(request: Parameters<typeof base.generate>[0]) {
      if (request.schemaName === 'evidence_assessment') {
        return { proposedState: 'SUPPORTED', confidence: 'HIGH', rationale: 'r', evidenceIds: ['00000000-0000-4000-8000-00000000dead'], causalStatus: 'NOT_APPLICABLE', scopeNotes: [], uncertainties: [] }
      }
      return base.generate(request)
    } }
    const id = await investigation('f-badref')
    const result = await run(id, 'f-badref', { llm })
    expect(result.failures.some((f) => f.node === 'analyze' && f.kind === 'MALFORMED_OUTPUT')).toBe(true)
    expect(await count('SELECT count(*) n FROM claims WHERE investigation_id = $1 AND state IS NOT NULL', [id])).toBe(0)
  })

  it('[HARD][FAILURE] contradiction: a model that tries to ignore it cannot produce SUPPORTED', async () => {
    const base = fixtureLlm({ claims: oneClaim })
    const llm = { ...base, async generate(request: Parameters<typeof base.generate>[0]) {
      if (request.schemaName === 'evidence_assessment') {
        const ids = [...request.user.matchAll(/<evidence id="([^"]+)" relationship="SUPPORTS"/g)].map((m) => m[1])
        return { proposedState: 'SUPPORTED', confidence: 'HIGH', rationale: 'Ignore the rest.', evidenceIds: ids, causalStatus: 'NOT_APPLICABLE', scopeNotes: [], uncertainties: [] }
      }
      return base.generate(request)
    } }
    const id = await investigation('f-contradiction')
    await run(id, 'f-contradiction', { llm })
    expect(await count("SELECT count(*) n FROM claims WHERE investigation_id = $1 AND state = 'SUPPORTED'", [id])).toBe(0)
    expect(await count("SELECT count(*) n FROM evidence WHERE investigation_id = $1 AND relationship = 'CONTRADICTS'", [id])).toBe(1)
  })

  it('[HARD][FAILURE] duplicate workflow execution: two concurrent runs create no duplicates', async () => {
    const id = await investigation('f-duplicate')
    await Promise.all([run(id, 'f-duplicate'), run(id, 'f-duplicate')])
    expect(await count('SELECT count(*) n FROM claims WHERE investigation_id = $1', [id])).toBe(1)
    expect(await count('SELECT count(*) n FROM evidence WHERE investigation_id = $1', [id])).toBe(2)
    expect(await count('SELECT count(*) n FROM sources WHERE investigation_id = $1', [id])).toBe(2)
  })

  it('[HARD][FAILURE] partial research failure: the failing claim is flagged and the others still complete', async () => {
    const mixed: SearchProvider = {
      async search(query) {
        if (query.includes('attendance')) throw new WorkflowError('NETWORK', 'offline')
        return corpus.search(query)
      },
    }
    const id = await investigation('f-partial')
    const result = await run(id, 'f-partial', { llm: fixtureLlm({ claims: [DEFAULT_CLAIMS[0], DEFAULT_CLAIMS[1]] }), search: mixed, maxRetries: 1 })
    expect(result.status).toBe('PARTIAL')
    expect(await count("SELECT count(*) n FROM claims WHERE investigation_id = $1 AND state = 'CONFLICTING'", [id])).toBe(1)
    expect(await count('SELECT count(*) n FROM claims WHERE investigation_id = $1 AND state IS NULL', [id])).toBe(1)
    expect((await pg.query<{ status: string }>('SELECT status FROM investigations WHERE id = $1', [id])).rows[0]?.status).toBe('REVIEW_REQUIRED')
  })

  it('[HARD][FAILURE] persistence failure: a database error is reported, never converted into success', async () => {
    const failing: Database = {
      async query<T>(sql: string, params?: unknown[]) {
        if (sql.includes('INSERT INTO evidence ')) throw Object.assign(new Error('disk full'), { code: '53100' })
        return pg.query<T>(sql, params)
      },
    }
    const id = await investigation('f-persist')
    const result = await runInvestigationWorkflow(
      { db: failing, llm: fixtureLlm({ claims: oneClaim }), search: corpus, maxRetries: 1 },
      { investigationId: id, ownerId: 'f-persist', question: '' },
    )
    expect(result.status).not.toBe('COMPLETED')
    expect(result.failures.some((f) => f.node === 'validateEvidence')).toBe(true)
    expect(await count('SELECT count(*) n FROM evidence WHERE investigation_id = $1', [id])).toBe(0)
    expect(await count("SELECT count(*) n FROM claims WHERE investigation_id = $1 AND state = 'SUPPORTED'", [id])).toBe(0)
  })

  it('[HARD][FAILURE] fatal credential failure: the run fails explicitly and the investigation is marked ERROR', async () => {
    const denied = { async generate(): Promise<never> { throw new WorkflowError('AUTHENTICATION', 'bad key') } }
    const id = await investigation('f-auth')
    const result = await run(id, 'f-auth', { llm: denied })
    expect(result.status).toBe('FAILED')
    expect((await pg.query<{ status: string }>('SELECT status FROM investigations WHERE id = $1', [id])).rows[0]?.status).toBe('ERROR')
  })
})
