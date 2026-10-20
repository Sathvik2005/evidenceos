// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Evidence, Source } from '../../src/api/contracts'
import App from '../../src/App'
import { ProgressSteps } from '../../src/components/ProgressSteps'
import { ProvenanceTable } from '../../src/components/ProvenanceTable'
import { GatewayProvider } from '../../src/gateway/GatewayProvider'
import { describeStep, WORKFLOW_STEPS } from '../../src/lib/labels'
import { FakeBackend } from '../helpers/fakeBackend'

afterEach(cleanup)

describe('workflow progress is the real, stored step', () => {
  it('names the step while a run is busy and where it stopped after an error', () => {
    const { rerender } = render(<ProgressSteps status="RESEARCHING" node="research" />)
    expect(screen.getByRole('status').textContent).toBe('Step 5 of 13: Researching sources')
    rerender(<ProgressSteps status="ERROR" node="analyze" />)
    expect(screen.getByRole('status').textContent).toBe('Stopped at step 7 of 13: Weighing the evidence')
  })

  it('shows no step text when the step is unknown or the run is finished, rather than guessing one', () => {
    const { rerender } = render(<ProgressSteps status="RESEARCHING" node={null} />)
    expect(screen.getByRole('status').textContent).toBe('')
    rerender(<ProgressSteps status="RESEARCHING" node="not-a-node" />)
    expect(screen.getByRole('status').textContent).toBe('')
    rerender(<ProgressSteps status="READY" node="summarize" />)
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('keeps the step list in the order the server runs it', () => {
    expect(WORKFLOW_STEPS.map((s) => s.node)).toEqual([
      'load', 'decompose', 'validateClaims', 'persistClaims', 'research', 'validateEvidence', 'analyze',
      'validateAssessment', 'evaluate', 'decide', 'persistState', 'detectChange', 'summarize',
    ])
    expect(describeStep('summarize')).toEqual({ position: 13, total: 13, label: 'Summarizing' })
  })
})

const source = (id: string, title: string): Source => ({
  id, investigationId: 'i', sourceType: 'OTHER', url: `https://example.org/${id}`, title,
  publisher: id === 's2' ? null : 'Example Press', publishedAt: '2026-01-02T00:00:00.000Z',
})
const ev = (id: string, sourceId: string, relationship: Evidence['relationship'], excerpt: string): Evidence => ({
  id, investigationId: 'i', claimId: 'c', sourceId, relationship, strength: 'MODERATE', excerpt, reasoning: null,
})

describe('provenance table', () => {
  const evidence = [
    ev('e1', 's1', 'SUPPORTS', 'It helped.'),
    ev('e2', 's2', 'CONTRADICTS', 'It did not help.'),
    ev('e3', 'gone', 'INSUFFICIENT', 'Unclear.'),
  ]
  const sources = [source('s1', 'Study one'), source('s2', 'Study two')]

  it('is a real table with headers, listing contradictions first and writing the relationship out', () => {
    render(<ProvenanceTable evidence={evidence} sources={sources} />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Relationship', 'Excerpt', 'Source', 'Publisher', 'Published', 'Strength'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent?.replace(/^\S+\s/, '')))
      .toEqual(['Contradicts', 'Supports', 'Insufficient to judge'])
  })

  it('shows source, publisher and date, and says so when they are missing instead of inventing them', () => {
    render(<ProvenanceTable evidence={evidence} sources={sources} />)
    expect(screen.getByRole('link', { name: 'Study one' }).getAttribute('href')).toBe('https://example.org/s1')
    expect(screen.getByText('Source record unavailable')).toBeTruthy()
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0)
  })

  it('renders nothing for a claim with no evidence', () => {
    const { container } = render(<ProvenanceTable evidence={[]} sources={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('navigation accessibility', () => {
  it('moves focus to the new page heading and updates the tab title after navigating', async () => {
    render(<GatewayProvider gateway={new FakeBackend()}><MemoryRouter><App /></MemoryRouter></GatewayProvider>)
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1 })) // first load never steals focus
    await userEvent.click(screen.getAllByRole('link', { name: /Begin an investigation|New investigation/ })[0]!)
    const heading = await screen.findByRole('heading', { name: 'Begin an investigation' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(document.title).toBe('Begin an investigation · EvidenceOS')
  })
})
