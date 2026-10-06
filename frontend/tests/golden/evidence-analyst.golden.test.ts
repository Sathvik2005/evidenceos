import { describe, expect, it } from 'vitest'
import { analyzeEvidence, validateAssessment, type AnalystEvidence } from '../../src/agents/evidenceAnalyst'
import { scriptedLlm } from '../helpers/scriptedLlm'

const claim = { id: 'claim-1', statement: 'Remote learning changes standardized test scores' }

const ev = (id: string, relationship: AnalystEvidence['relationship'], strength: AnalystEvidence['strength'] = 'MODERATE'): AnalystEvidence => ({
  id,
  sourceTitle: `Source ${id}`,
  sourceUrl: `https://example.org/${id}`,
  publishedAt: null,
  excerpt: `Excerpt for ${id}.`,
  relationship,
  strength,
})

const output = (overrides: Record<string, unknown> = {}) => ({
  proposedState: 'PARTIALLY_SUPPORTED',
  confidence: 'MEDIUM',
  rationale: 'Mixed findings.',
  evidenceIds: ['e1'],
  causalStatus: 'CORRELATION',
  scopeNotes: [],
  uncertainties: [],
  ...overrides,
})

describe('Evidence Analyst: golden cases', () => {
  it('supported: strong supporting evidence, no contradiction', async () => {
    const evidence = [ev('e1', 'SUPPORTS', 'STRONG'), ev('e2', 'SUPPORTS')]
    const llm = scriptedLlm(output({ proposedState: 'SUPPORTED', confidence: 'HIGH', evidenceIds: ['e1', 'e2'], causalStatus: 'CAUSATION' }))
    const result = await analyzeEvidence(llm, claim, evidence)
    expect(result).toMatchObject({ claimId: 'claim-1', proposedState: 'SUPPORTED', confidence: 'HIGH' })
    expect(result.evidenceIds).toEqual(['e1', 'e2'])
  })

  it('partial: mixed evidence keeps both ids and scope notes', async () => {
    const evidence = [ev('e1', 'PARTIALLY_SUPPORTS'), ev('e2', 'INSUFFICIENT', 'WEAK')]
    const llm = scriptedLlm(output({ evidenceIds: ['e1', 'e2'], scopeNotes: ['Only primary-school students were studied.'] }))
    const result = await analyzeEvidence(llm, claim, evidence)
    expect(result.proposedState).toBe('PARTIALLY_SUPPORTED')
    expect(result.scopeNotes).toHaveLength(1)
  })

  it('conflicting: contradicting evidence is cited alongside supporting evidence', async () => {
    const evidence = [ev('e1', 'SUPPORTS'), ev('e2', 'CONTRADICTS')]
    const llm = scriptedLlm(output({ proposedState: 'CONFLICTING', evidenceIds: ['e1', 'e2'] }))
    const result = await analyzeEvidence(llm, claim, evidence)
    expect(result.proposedState).toBe('CONFLICTING')
    expect(result.evidenceIds).toContain('e2')
  })

  it('insufficient: no evidence yields INSUFFICIENT without calling the model', async () => {
    const llm = scriptedLlm(output())
    const result = await analyzeEvidence(llm, claim, [])
    expect(result).toMatchObject({ proposedState: 'INSUFFICIENT', confidence: 'LOW', evidenceIds: [] })
    expect(llm.requests).toHaveLength(0)
  })
})

describe('Evidence Analyst: guards', () => {
  const evidence = [ev('e1', 'SUPPORTS'), ev('e2', 'CONTRADICTS')]

  it('rejects an assessment that silently drops contradicting evidence', () => {
    const result = validateAssessment(output({ proposedState: 'SUPPORTED', evidenceIds: ['e1'] }), 'claim-1', evidence)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors.join(' ')).toContain('contradicting evidence e2')
  })

  it('rejects invented evidence ids and unauthorized fields', () => {
    expect(validateAssessment(output({ evidenceIds: ['e1', 'e2', 'e99'] }), 'claim-1', evidence).ok).toBe(false)
    expect(validateAssessment(output({ evidenceIds: ['e1', 'e2'], newEvidence: [{ excerpt: 'made up' }] }), 'claim-1', evidence).ok).toBe(false)
    expect(validateAssessment(output({ evidenceIds: ['e1', 'e2'], claimId: 'other' }), 'claim-1', evidence).ok).toBe(false)
  })

  it('rejects a non-INSUFFICIENT state that cites nothing, and invalid enums', () => {
    expect(validateAssessment(output({ evidenceIds: [] }), 'claim-1', [ev('e1', 'SUPPORTS')]).ok).toBe(false)
    expect(validateAssessment(output({ proposedState: 'TRUE', evidenceIds: ['e1', 'e2'] }), 'claim-1', evidence).ok).toBe(false)
    expect(validateAssessment(output({ confidence: 'CERTAIN', evidenceIds: ['e1', 'e2'] }), 'claim-1', evidence).ok).toBe(false)
  })

  it('retries within the bound with feedback, then succeeds', async () => {
    const llm = scriptedLlm(output({ evidenceIds: ['e1'] }), output({ proposedState: 'CONFLICTING', evidenceIds: ['e1', 'e2'] }))
    const result = await analyzeEvidence(llm, claim, evidence)
    expect(result.proposedState).toBe('CONFLICTING')
    expect(llm.requests).toHaveLength(2)
  })

  it('fails explicitly when the model never produces a valid assessment', async () => {
    const llm = scriptedLlm(output({ evidenceIds: ['e1'] }))
    await expect(analyzeEvidence(llm, claim, evidence, { maxRetries: 1 })).rejects.toMatchObject({ kind: 'MALFORMED_OUTPUT' })
    expect(llm.requests).toHaveLength(2)
  })

  it('presents evidence as untrusted data', async () => {
    const llm = scriptedLlm(output({ evidenceIds: ['e1', 'e2'] }))
    await analyzeEvidence(llm, claim, evidence)
    expect(llm.requests[0]?.system).toContain('untrusted data')
    expect(llm.requests[0]?.user).toContain('<evidence id="e1"')
  })
})
