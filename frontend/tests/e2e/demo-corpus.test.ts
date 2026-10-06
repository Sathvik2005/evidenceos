// Rehearsal test for the signature demo moment using the REAL recorded corpus (demo/corpus.json).
// Only the model is scripted; documents, validation, persistence and change detection are the product's.
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeUrl, sanitizeDocuments } from '../../src/agents/researchAgent'
import { createInvestigation } from '../../src/api/operations'
import { createRecordedSearch, type RecordedDocument } from '../../src/server/adapters/recorded'
import { runInvestigationWorkflow } from '../../src/workflow/run'
import { fixtureLlm } from '../helpers/fixtureLlm'
import { createMigratedDatabase } from '../helpers/migratedDb'

const corpusPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../demo/corpus.json')
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as { documents: RecordedDocument[] }

let pg: PGlite
beforeAll(async () => {
  pg = await createMigratedDatabase()
})
afterAll(async () => {
  await pg.close()
})

describe('recorded demo corpus', () => {
  it('contains only well-formed, https, dated documents that survive provider hygiene', () => {
    const clean = sanitizeDocuments(corpus.documents)
    expect(clean).toHaveLength(corpus.documents.length)
    expect(corpus.documents.every((d) => d.url.startsWith('https://') && !Number.isNaN(Date.parse(d.retrievedAt)) && [1, 2].includes(d.phase))).toBe(true)
  })

  it('reveals the new evidence only at phase 2', async () => {
    expect((await createRecordedSearch(corpus.documents, 1).search('q')).documents).toHaveLength(1)
    expect((await createRecordedSearch(corpus.documents, 2).search('q')).documents).toHaveLength(3)
  })

  it('PARTIALLY_SUPPORTED -> new evidence -> CONFLICTING, with real excerpts and a recorded trigger', async () => {
    const created = await createInvestigation(pg, 'demo', { question: 'Does remote learning improve student outcomes?' })
    if (!created.ok) throw new Error('setup failed')
    const llm = fixtureLlm({
      claims: ['Remote learning changes student academic outcomes compared with in-person instruction'],
      research: (request) => ({
        candidates: [...request.user.matchAll(/<document index="(\d+)">\n([\s\S]*?)\n<\/document>/g)].map((m) => ({
          documentIndex: Number(m[1]),
          excerpt: (m[2] ?? '').split(/(?<=\.)\s/)[0],
          relationship: /modestly better/.test(m[2] ?? '') ? 'PARTIALLY_SUPPORTS' : 'CONTRADICTS',
          strength: 'MODERATE',
        })),
      }),
    })
    const run = (phase: number) =>
      runInvestigationWorkflow({ db: pg, llm, search: createRecordedSearch(corpus.documents, phase) }, { investigationId: created.data.id, ownerId: 'demo', question: '' })
    const stateOf = async () => (await pg.query<{ state: string }>('SELECT state FROM claims WHERE investigation_id = $1', [created.data.id])).rows[0]?.state

    expect((await run(1)).status).toBe('COMPLETED')
    expect(await stateOf()).toBe('PARTIALLY_SUPPORTED')

    expect((await run(2)).status).toBe('COMPLETED')
    expect(await stateOf()).toBe('CONFLICTING')
    const { rows } = await pg.query<{ previous_state: string; new_state: string; excerpt: string; url: string }>(
      `SELECT ch.previous_state, ch.new_state, e.excerpt, s.url FROM evidence_changes ch
       JOIN evidence e ON e.id = ch.triggering_evidence_id JOIN sources s ON s.id = e.source_id WHERE ch.investigation_id = $1`, [created.data.id])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ previous_state: 'PARTIALLY_SUPPORTED', new_state: 'CONFLICTING' })
    // The trigger is a real, retrieved contradicting source, not an invented one.
    expect(corpus.documents.some((d) => normalizeUrl(d.url) === rows[0]?.url && d.text.includes(rows[0]?.excerpt ?? '#'))).toBe(true)
    expect(rows[0]?.url).not.toContain('sri.com')
  })
})
