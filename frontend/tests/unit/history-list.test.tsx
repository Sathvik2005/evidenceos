// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Claim, Evidence, EvidenceChange, Source } from '../../src/api/contracts'
import { HistoryList } from '../../src/components/HistoryList'

afterEach(cleanup)

const claim: Claim = { id: 'c1', investigationId: 'i1', ordinal: 1, statement: 'Remote learning raises scores', state: 'CONFLICTING', confidence: 'MEDIUM', assessmentReason: null }
const source: Source = { id: 's1', investigationId: 'i1', sourceType: 'OTHER', url: 'https://example.org/study', title: 'The district study', publisher: 'Example Press', publishedAt: '2026-01-02T00:00:00.000Z' }
const evidence: Evidence = { id: 'e1', investigationId: 'i1', claimId: 'c1', sourceId: 's1', relationship: 'CONTRADICTS', strength: 'STRONG', excerpt: 'Scores fell by 22 percent of a standard deviation.', reasoning: null }
const change: EvidenceChange = { id: 'h1', investigationId: 'i1', claimId: 'c1', previousState: 'PARTIALLY_SUPPORTED', newState: 'CONFLICTING', reason: 'A stronger study disagrees.', triggeringEvidenceId: 'e1', changedAt: '2026-10-06T00:00:00.000Z' }

const show = (props: Partial<Parameters<typeof HistoryList>[0]> = {}) =>
  render(<MemoryRouter><HistoryList changes={[change]} evidence={[evidence]} claims={[claim]} sources={[source]} investigationId="i1" {...props} /></MemoryRouter>)

describe('what changed timeline', () => {
  it('shows the transition, the triggering evidence with its source, and links to the claim', () => {
    show()
    expect(screen.getByText('Scores fell by 22 percent of a standard deviation.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'The district study' }).getAttribute('href')).toBe('https://example.org/study')
    expect(screen.getByText(/Contradicts/)).toBeTruthy() // the relationship is written out, not only colored
    expect(screen.getByRole('link', { name: 'Remote learning raises scores' }).getAttribute('href')).toBe('/investigations/i1/claims/c1')
    expect(screen.getByText(/1 recorded change/)).toBeTruthy()
  })

  it('says so when the triggering evidence record is missing instead of inventing one', () => {
    show({ evidence: [] })
    expect(screen.getByText('The triggering evidence record is unavailable.')).toBeTruthy()
  })

  it('explains an empty history without implying a failure', () => {
    show({ changes: [] })
    expect(screen.getByText(/No state changes yet/)).toBeTruthy()
  })
})
