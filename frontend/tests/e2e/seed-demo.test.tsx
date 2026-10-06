// @vitest-environment jsdom
// The seeded demo: real persisted data, written through the product's operations and hard rules.
import type { PGlite } from '@electric-sql/pglite'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import App from '../../src/App'
import { listClaims } from '../../src/api/operations'
import { GatewayProvider } from '../../src/gateway/GatewayProvider'
import type { RecordedDocument } from '../../src/server/adapters/recorded'
import { seedAdvance, seedInitial } from '../../src/server/seed'
import { directGateway } from '../helpers/directGateway'
import { createMigratedDatabase } from '../helpers/migratedDb'

const corpus = (JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../demo/corpus.json'), 'utf8')) as { documents: RecordedDocument[] }).documents
const OWNER = 'seed-owner'
let pg: PGlite
let id = ''

const count = async (sql: string) => Number((await pg.query<{ n: string }>(sql, [id])).rows[0]?.n ?? 0)

beforeAll(async () => {
  pg = await createMigratedDatabase()
  id = await seedInitial(pg, OWNER, corpus)
})
afterAll(async () => {
  await pg.close()
})
afterEach(cleanup)

describe('seed data', () => {
  it('stage 1: one partially supported claim, one insufficient claim, no history yet', async () => {
    const claims = await listClaims(pg, OWNER, id)
    expect(claims.ok && claims.data.map((c) => [c.state, c.confidence])).toEqual([['PARTIALLY_SUPPORTED', 'LOW'], ['INSUFFICIENT', 'LOW']])
    expect(await count('SELECT count(*) n FROM evidence WHERE investigation_id = $1')).toBe(1)
    expect(await count('SELECT count(*) n FROM evidence_changes WHERE investigation_id = $1')).toBe(0)
    expect((await pg.query<{ status: string }>('SELECT status FROM investigations WHERE id = $1', [id])).rows[0]?.status).toBe('READY')
  })

  it('is idempotent: seeding again creates nothing new', async () => {
    expect(await seedInitial(pg, OWNER, corpus)).toBe(id)
    expect(await count('SELECT count(*) n FROM claims WHERE investigation_id = $1')).toBe(2)
    expect(await count('SELECT count(*) n FROM evidence WHERE investigation_id = $1')).toBe(1)
  })

  it('stores only verbatim, retrieved quotes with their real sources', async () => {
    const { rows } = await pg.query<{ excerpt: string; url: string }>(
      'SELECT e.excerpt, s.url FROM evidence e JOIN sources s ON s.id = e.source_id WHERE e.investigation_id = $1', [id])
    for (const row of rows) expect(corpus.some((d) => d.text === row.excerpt && d.url.replace(/\/$/, '') === row.url)).toBe(true)
  })

  it('renders the seeded state honestly in the UI, labelling authored text as seed data', async () => {
    const gateway = directGateway(pg, OWNER, async () => undefined)
    const claims = await listClaims(pg, OWNER, id)
    if (!claims.ok) throw new Error('setup failed')
    render(<MemoryRouter initialEntries={[`/investigations/${id}/claims/${claims.data[0]?.id}`]}><GatewayProvider gateway={gateway}><App /></GatewayProvider></MemoryRouter>)
    expect(await screen.findByText('Partially supported')).toBeTruthy()
    expect(screen.getAllByText(/Seed fixture \(authored, not model output\)/).length).toBeGreaterThan(0)
  })
})

describe('seed stage 2: new evidence', () => {
  it('PARTIALLY_SUPPORTED -> CONFLICTING is recorded once, with real triggering evidence, and earlier evidence is kept', async () => {
    await seedAdvance(pg, OWNER, id, corpus)
    await seedAdvance(pg, OWNER, id, corpus) // again: no meaningful difference, no new history

    const { rows } = await pg.query<{ previous_state: string; new_state: string; relationship: string; url: string }>(
      `SELECT ch.previous_state, ch.new_state, e.relationship, s.url FROM evidence_changes ch
       JOIN evidence e ON e.id = ch.triggering_evidence_id JOIN sources s ON s.id = e.source_id WHERE ch.investigation_id = $1`, [id])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ previous_state: 'PARTIALLY_SUPPORTED', new_state: 'CONFLICTING', relationship: 'CONTRADICTS' })
    expect(rows[0]?.url).toContain('educationnext.org')
    expect(await count('SELECT count(*) n FROM evidence WHERE investigation_id = $1')).toBe(3)
    const claims = await listClaims(pg, OWNER, id)
    expect(claims.ok && claims.data.map((c) => c.state)).toEqual(['CONFLICTING', 'INSUFFICIENT'])
  })

  it('shows the contradiction, the kept earlier evidence and the history in the UI', async () => {
    const gateway = directGateway(pg, OWNER, async () => undefined)
    const claims = await listClaims(pg, OWNER, id)
    if (!claims.ok) throw new Error('setup failed')
    render(<MemoryRouter initialEntries={[`/investigations/${id}/claims/${claims.data[0]?.id}`]}><GatewayProvider gateway={gateway}><App /></GatewayProvider></MemoryRouter>)
    expect((await screen.findAllByText('Conflicting')).length).toBeGreaterThan(0)
    const contradictory = screen.getByRole('region', { name: 'Contradictory evidence' })
    await waitFor(() => expect(within(contradictory).getAllByRole('figure')).toHaveLength(2))
    expect(within(screen.getByRole('region', { name: 'Supporting evidence' })).getAllByRole('figure')).toHaveLength(1)
    const history = screen.getByRole('region', { name: 'History' })
    expect(within(history).getByText(/Triggered by new evidence/)).toBeTruthy()
  })
})
