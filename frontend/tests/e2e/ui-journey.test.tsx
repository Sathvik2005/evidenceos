// @vitest-environment jsdom
// Browser-level journey against real persisted state (controlled research fixtures, no mocks of the
// backend contracts): question -> investigation -> claims -> evidence -> history -> graph.
import type { PGlite } from '@electric-sql/pglite'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import type { RetrievedDocument, SearchProvider } from '../../src/agents/researchAgent'
import { createInvestigation, listClaims } from '../../src/api/operations'
import { GatewayProvider } from '../../src/gateway/GatewayProvider'
import type { InvestigationGateway } from '../../src/gateway/types'
import { buildEvidenceGraph } from '../../src/graph/buildGraph'
import { runInvestigationWorkflow } from '../../src/workflow/run'
import { fixtureLlm, DEFAULT_CLAIMS } from '../helpers/fixtureLlm'
import { directGateway } from '../helpers/directGateway'
import { createMigratedDatabase } from '../helpers/migratedDb'

const OWNER = 'ui-owner'
let pg: PGlite

const doc = (slug: string, text: string): RetrievedDocument => ({
  url: `https://example.org/${slug}`, title: `Source ${slug}`, sourceType: 'JOURNAL_ARTICLE', publisher: 'Example Journal',
  publishedAt: '2022-05-01T00:00:00.000Z', retrievedAt: '2026-01-01T00:00:00.000Z', text,
})
const partly = doc('scores-partly', 'Remote students partly improved reading scores in one district.')
const declined = doc('scores-down', 'Average math scores declined after the move to remote learning.')
const attendance = doc('attendance', 'Remote students improved attendance rates in rural schools.')

let phase = 1
const corpus: SearchProvider = {
  async search(query) {
    if (query.includes('test scores')) return { documents: phase === 1 ? [partly] : [partly, declined] }
    if (query.includes('attendance')) return { documents: [attendance] }
    return { documents: [] }
  },
}

const llm = fixtureLlm({ claims: [...DEFAULT_CLAIMS] })
const runWorkflow = (id: string) => runInvestigationWorkflow({ db: pg, llm, search: corpus }, { investigationId: id, ownerId: OWNER, question: '' })

beforeAll(async () => {
  pg = await createMigratedDatabase()
})
afterAll(async () => {
  await pg.close()
})
afterEach(cleanup)

function renderApp(path: string, gateway: InvestigationGateway | null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GatewayProvider gateway={gateway}><App /></GatewayProvider>
    </MemoryRouter>,
  )
}

async function seeded(): Promise<string> {
  const created = await createInvestigation(pg, OWNER, { question: 'Does remote learning improve student outcomes?' })
  if (!created.ok) throw new Error('setup failed')
  await runWorkflow(created.data.id)
  return created.data.id
}

async function claimId(investigationId: string, ordinal: number): Promise<string> {
  const claims = await listClaims(pg, OWNER, investigationId)
  const claim = claims.ok ? claims.data.find((c) => c.ordinal === ordinal) : undefined
  if (!claim) throw new Error('claim missing')
  return claim.id
}

describe('browser journey', () => {
  it('starts an investigation and shows real progress, then the persisted claims', async () => {
    phase = 1
    const gateway = directGateway(pg, OWNER, runWorkflow)
    renderApp('/investigations/new', gateway)
    await userEvent.type(screen.getByLabelText('Question'), 'Does remote learning improve student outcomes?')
    await userEvent.click(screen.getByRole('button', { name: 'Start investigation' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Does remote learning improve student outcomes?' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Investigation stage' })).toBeTruthy()
    expect(screen.queryByText(/%/)).toBeNull() // progress is never a made-up percentage
    expect(gateway.runs).toHaveLength(1)

    await waitFor(() => expect(screen.getByText('Remote learning changes standardized test scores')).toBeTruthy(), { timeout: 15000 })
    await waitFor(() => expect(screen.getByText(/Investigation · Ready/)).toBeTruthy(), { timeout: 15000 })
    expect(screen.getAllByText(/Confidence:/).length).toBe(3)
  }, 30000)

  it('rejects an empty question without calling the backend', async () => {
    const gateway = directGateway(pg, OWNER, runWorkflow)
    renderApp('/investigations/new', gateway)
    await userEvent.click(screen.getByRole('button', { name: 'Start investigation' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a question')
    expect(gateway.runs).toHaveLength(0)
  })

  it('says so plainly when no backend is configured', () => {
    renderApp('/investigations/new', null)
    expect(screen.getByRole('alert').textContent).toContain('no backend configured')
  })
})

describe('claim detail', () => {
  it('conflicting claim: contradictory evidence is prominent and provenance is shown', async () => {
    phase = 2
    const id = await seeded()
    renderApp(`/investigations/${id}/claims/${await claimId(id, 1)}`, directGateway(pg, OWNER, runWorkflow))

    expect(await screen.findByText('Conflicting')).toBeTruthy()
    expect(screen.getByText('Confidence: Medium')).toBeTruthy()
    const contradictory = screen.getByRole('region', { name: 'Contradictory evidence' })
    expect(within(contradictory).getByText(declined.text)).toBeTruthy()
    expect(within(contradictory).getByText('Contradicts')).toBeTruthy()
    const link = within(contradictory).getByRole('link', { name: 'Source scores-down' })
    expect(link.getAttribute('href')).toBe('https://example.org/scores-down')
    expect(link.getAttribute('rel')).toContain('noopener')
  }, 30000)

  it('supported claim: states that no contradiction is recorded', async () => {
    phase = 2
    const id = await seeded()
    renderApp(`/investigations/${id}/claims/${await claimId(id, 2)}`, directGateway(pg, OWNER, runWorkflow))
    expect(await screen.findByText('Supported')).toBeTruthy()
    expect(screen.getByText('No contradicting evidence is recorded for this claim.')).toBeTruthy()
    expect(screen.getByText(attendance.text)).toBeTruthy()
  }, 30000)

  it('insufficient claim: shows the insufficiency notice instead of inventing evidence', async () => {
    phase = 2
    const id = await seeded()
    renderApp(`/investigations/${id}/claims/${await claimId(id, 3)}`, directGateway(pg, OWNER, runWorkflow))
    expect(await screen.findByText('Insufficient evidence', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByText('No supporting evidence is recorded.')).toBeTruthy()
  }, 30000)

  it('partially supported claim: shows partial support', async () => {
    phase = 1
    const id = await seeded()
    renderApp(`/investigations/${id}/claims/${await claimId(id, 1)}`, directGateway(pg, OWNER, runWorkflow))
    expect(await screen.findByText('Partially supported')).toBeTruthy()
    expect(screen.getByText(partly.text)).toBeTruthy()
  }, 30000)

  it('shows an error with a working retry when the backend fails', async () => {
    const failing = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Backend exploded.' } })
      .mockResolvedValue({ ok: true, data: [] })
    const gateway = { ...directGateway(pg, OWNER, runWorkflow), listClaims: failing }
    renderApp('/investigations/00000000-0000-4000-8000-000000000000/claims/x', gateway)
    expect((await screen.findByRole('alert')).textContent).toContain('Backend exploded.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Investigation not found.')).toBeTruthy()
    expect(failing).toHaveBeenCalledTimes(2)
  })
})

describe('change history and graph', () => {
  it('surfaces PARTIALLY_SUPPORTED -> CONFLICTING with the triggering evidence, then graphs it', async () => {
    phase = 1
    const created = await createInvestigation(pg, OWNER, { question: 'Does remote learning improve student outcomes?' })
    if (!created.ok) throw new Error('setup failed')
    const only = fixtureLlm({ claims: [DEFAULT_CLAIMS[0]] })
    const run = () => runInvestigationWorkflow({ db: pg, llm: only, search: corpus }, { investigationId: created.data.id, ownerId: OWNER, question: '' })
    await run()
    phase = 2
    await run()

    const gateway = directGateway(pg, OWNER, runWorkflow)
    renderApp(`/investigations/${created.data.id}`, gateway)
    const history = await screen.findByRole('heading', { name: 'State history' })
    expect(history).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/Triggered by new evidence/)).toBeTruthy())
    expect(screen.getByText(/Average math scores declined/)).toBeTruthy()
    cleanup()

    renderApp(`/investigations/${created.data.id}/graph`, gateway)
    expect(await screen.findByRole('heading', { name: 'Relationships (text version)' })).toBeTruthy()
    expect(screen.getAllByRole('listitem').some((li) => li.textContent?.includes('contradicts'))).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /^evidence: Average math scores declined/ }))
    expect(screen.getByText(declined.text, { selector: '.graph__inspector p' })).toBeTruthy()
  }, 30000)

  it('builds graphs only from persisted records and skips dangling references', () => {
    const graph = buildEvidenceGraph(
      [{ id: 'c1', investigationId: 'i', ordinal: 1, statement: 'A claim', state: null, confidence: null, assessmentReason: null }],
      [
        { id: 'e1', investigationId: 'i', claimId: 'c1', sourceId: 's1', relationship: 'CONTRADICTS', strength: 'STRONG', excerpt: 'Quote', reasoning: null },
        { id: 'e2', investigationId: 'i', claimId: 'ghost', sourceId: 's1', relationship: 'SUPPORTS', strength: 'WEAK', excerpt: 'Dangling', reasoning: null },
      ],
      [{ id: 's1', investigationId: 'i', sourceType: 'WEB_PAGE', url: 'https://example.org/a', title: 'A', publisher: null, publishedAt: null }],
    )
    expect(graph.nodes.map((n) => n.id)).toEqual(['claim:c1', 'evidence:e1', 'source:s1'])
    expect(graph.edges).toEqual([
      { from: 'claim:c1', to: 'evidence:e1', kind: 'CONTRADICTS' },
      { from: 'evidence:e1', to: 'source:s1', kind: 'CITES' },
    ])
  })
})
