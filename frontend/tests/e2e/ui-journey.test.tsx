// @vitest-environment jsdom
// Browser-level journey against a fixed, in-memory backend: question -> investigation -> claims -> evidence ->
// history -> graph. How the real backend produces these records is covered by the Python test suite
// (backend/tests); here the data is fixed so the UI is checked for honest rendering of every state.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { GatewayProvider } from '../../src/gateway/GatewayProvider'
import type { InvestigationGateway } from '../../src/gateway/types'
import { buildEvidenceGraph } from '../../src/graph/buildGraph'
import {
  CLAIMS, FakeBackend, INV, SEED_LABEL, TEXT, conflictingScenario, partialScenario, seededConflictScenario,
} from '../helpers/fakeBackend'

afterEach(cleanup)

function renderApp(path: string, gateway: InvestigationGateway | null) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GatewayProvider gateway={gateway}><App /></GatewayProvider>
    </MemoryRouter>,
  )
}

describe('browser journey', () => {
  it('starts an investigation and shows real progress, then the persisted claims', async () => {
    const backend = new FakeBackend()
    renderApp('/investigations/new', backend)
    await userEvent.type(screen.getByLabelText('Question'), 'Does remote learning improve student outcomes?')
    await userEvent.click(screen.getByRole('button', { name: 'Start investigation' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Does remote learning improve student outcomes?' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Investigation stage' })).toBeTruthy()
    expect(screen.queryByText(/%/)).toBeNull() // progress is never a made-up percentage
    expect(backend.runs).toHaveLength(1)

    // The server finishes its run later; the UI observes the persisted result rather than inventing progress.
    const created = backend.runs[0] as string
    const finished = conflictingScenario()
    backend.load({
      claims: finished.claims.map((c) => ({ ...c, investigationId: created })),
      sources: finished.sources.map((s) => ({ ...s, investigationId: created })),
      evidence: finished.evidence.map((e) => ({ ...e, investigationId: created })),
    })
    backend.setStatus(created, 'READY')

    await waitFor(() => expect(screen.getByText(CLAIMS.scores)).toBeTruthy(), { timeout: 15000 })
    await waitFor(() => expect(screen.getByText(/Investigation · Ready/)).toBeTruthy(), { timeout: 15000 })
    expect(screen.getAllByText(/Confidence:/).length).toBe(3)
  }, 30000)

  it('rejects an empty question without calling the backend', async () => {
    const backend = new FakeBackend()
    renderApp('/investigations/new', backend)
    await userEvent.click(screen.getByRole('button', { name: 'Start investigation' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a question')
    expect(backend.runs).toHaveLength(0)
  })

  it('says so plainly when no backend is configured', () => {
    renderApp('/investigations/new', null)
    expect(screen.getByRole('alert').textContent).toContain('no backend configured')
  })
})

describe('claim detail', () => {
  it('conflicting claim: contradictory evidence is prominent and provenance is shown', async () => {
    renderApp(`/investigations/${INV}/claims/c1`, new FakeBackend(conflictingScenario()))
    expect((await screen.findAllByText('Conflicting')).length).toBeGreaterThan(0) // the badge, and the history entry
    expect(screen.getByText('Confidence: Medium')).toBeTruthy()
    const contradictory = screen.getByRole('region', { name: 'Contradictory evidence' })
    expect(within(contradictory).getByText(TEXT.declined)).toBeTruthy()
    expect(within(contradictory).getByText('Contradicts')).toBeTruthy()
    const link = within(contradictory).getByRole('link', { name: 'Source scores-down' })
    expect(link.getAttribute('href')).toBe('https://example.org/scores-down')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('supported claim: states that no contradiction is recorded', async () => {
    renderApp(`/investigations/${INV}/claims/c2`, new FakeBackend(conflictingScenario()))
    expect(await screen.findByText('Supported')).toBeTruthy()
    expect(screen.getByText('No contradicting evidence is recorded for this claim.')).toBeTruthy()
    expect(screen.getByText(TEXT.attendance)).toBeTruthy()
  })

  it('insufficient claim: shows the insufficiency notice instead of inventing evidence', async () => {
    renderApp(`/investigations/${INV}/claims/c3`, new FakeBackend(conflictingScenario()))
    expect(await screen.findByText('Insufficient evidence', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByText('No supporting evidence is recorded.')).toBeTruthy()
  })

  it('partially supported claim: shows partial support', async () => {
    renderApp(`/investigations/${INV}/claims/c1`, new FakeBackend(partialScenario()))
    expect(await screen.findByText('Partially supported')).toBeTruthy()
    expect(screen.getByText(TEXT.partly)).toBeTruthy()
  })

  it('shows an error with a working retry when the backend fails', async () => {
    const failing = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Backend exploded.' } })
      .mockResolvedValue({ ok: true, data: [] })
    const gateway: InvestigationGateway = Object.assign(new FakeBackend(), { listClaims: failing })
    renderApp('/investigations/00000000-0000-4000-8000-000000000000/claims/x', gateway)
    expect((await screen.findByRole('alert')).textContent).toContain('Backend exploded.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Investigation not found.')).toBeTruthy()
    expect(failing).toHaveBeenCalledTimes(2)
  })
})

describe('change history and graph', () => {
  it('surfaces PARTIALLY_SUPPORTED -> CONFLICTING with the triggering evidence, then graphs it', async () => {
    const backend = new FakeBackend(conflictingScenario())
    renderApp(`/investigations/${INV}`, backend)
    expect(await screen.findByRole('heading', { name: 'State history' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/Triggered by new evidence/)).toBeTruthy())
    expect(screen.getByText(/Average math scores declined/)).toBeTruthy()
    cleanup()

    renderApp(`/investigations/${INV}/graph`, backend)
    expect(await screen.findByRole('heading', { name: 'Relationships (text version)' })).toBeTruthy()
    expect(screen.getAllByRole('listitem').some((li) => li.textContent?.includes('contradicts'))).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /^evidence: Average math scores declined/ }))
    expect(screen.getByText(TEXT.declined, { selector: '.graph__inspector p' })).toBeTruthy()
  })

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

describe('seeded demo data', () => {
  it('renders the first stage honestly, labelling authored text as seed data', async () => {
    const stage = seededConflictScenario()
    const backend = new FakeBackend({
      ...stage,
      claims: stage.claims.map((c) => (c.id === 'c1' ? { ...c, state: 'PARTIALLY_SUPPORTED' as const, confidence: 'LOW' as const } : c)),
      evidence: stage.evidence.slice(0, 1),
      changes: [],
    })
    renderApp(`/investigations/${INV}/claims/c1`, backend)
    expect(await screen.findByText('Partially supported')).toBeTruthy()
    expect(screen.getAllByText(new RegExp(SEED_LABEL.replace(/[()]/g, '\\$&'))).length).toBeGreaterThan(0)
  })

  it('shows the contradiction, the kept earlier evidence and the history after new evidence', async () => {
    renderApp(`/investigations/${INV}/claims/c1`, new FakeBackend(seededConflictScenario()))
    expect((await screen.findAllByText('Conflicting')).length).toBeGreaterThan(0)
    const contradictory = screen.getByRole('region', { name: 'Contradictory evidence' })
    await waitFor(() => expect(within(contradictory).getAllByRole('figure')).toHaveLength(2))
    expect(within(screen.getByRole('region', { name: 'Supporting evidence' })).getAllByRole('figure')).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'History' })).getByText(/Triggered by new evidence/)).toBeTruthy()
  })
})
