import { describe, expect, it } from 'vitest'
import { evaluateAssessment, validateAudit } from '../../src/agents/evaluator'
import type { AnalystEvidence, EvidenceAssessment } from '../../src/agents/evidenceAnalyst'
import { scriptedLlm } from '../helpers/scriptedLlm'

const claim = { id: 'c1', statement: 'Remote learning changes standardized test scores' }

const ev = (id: string, relationship: AnalystEvidence['relationship'], strength: AnalystEvidence['strength'] = 'MODERATE') => ({
  id, claimId: 'c1', sourceTitle: id, sourceUrl: `https://example.org/${id}`, publishedAt: null,
  excerpt: `Excerpt ${id}.`, relationship, strength,
})

const assessment = (patch: Partial<EvidenceAssessment> = {}): EvidenceAssessment => ({
  claimId: 'c1', proposedState: 'CONFLICTING', confidence: 'MEDIUM', rationale: 'Findings disagree.',
  evidenceIds: ['e1', 'e2'], causalStatus: 'CORRELATION', scopeNotes: [], uncertainties: [], ...patch,
})

const evidence = [ev('e1', 'SUPPORTS'), ev('e2', 'CONTRADICTS')]

const audit = (scores: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  scores: { evidenceQuality: 2, grounding: 2, contradictionHandling: 2, stateJustification: 2, uncertaintyHandling: 2, ...scores },
  criticalFailures: [],
  findings: [],
  ...extra,
})

describe('Evaluator golden cases', () => {
  it('accepts a well-grounded assessment (total 10)', async () => {
    const result = await evaluateAssessment(scriptedLlm(audit({})), claim, evidence, assessment())
    expect(result).toMatchObject({ decision: 'ACCEPT', total: 10 })
  })

  it('accepts exactly at the threshold (total 7, grounding and justification >= 1)', async () => {
    const llm = scriptedLlm(audit({ evidenceQuality: 1, grounding: 1, contradictionHandling: 1, stateJustification: 2, uncertaintyHandling: 2 }))
    expect((await evaluateAssessment(llm, claim, evidence, assessment())).decision).toBe('ACCEPT')
  })

  it.each([
    ['total below 7', { evidenceQuality: 1, grounding: 1, contradictionHandling: 1, stateJustification: 1, uncertaintyHandling: 1 }],
    ['grounding 0', { grounding: 0 }],
    ['state justification 0', { stateJustification: 0 }],
  ])('rejects when %s', async (_label, scores) => {
    const result = await evaluateAssessment(scriptedLlm(audit(scores)), claim, evidence, assessment())
    expect(result.decision).toBe('REJECT')
  })

  it('rejects on any critical failure even with perfect scores', async () => {
    const llm = scriptedLlm(audit({}, { criticalFailures: ['hidden contradiction'] }))
    const result = await evaluateAssessment(llm, claim, evidence, assessment())
    expect(result.decision).toBe('REJECT')
    expect(result.criticalFailures).toEqual(['hidden contradiction'])
  })

  it('hard-rule failure overrides a perfect evaluation and skips the model entirely', async () => {
    const llm = scriptedLlm(audit({}))
    const bad = assessment({ proposedState: 'SUPPORTED', evidenceIds: ['e1'] })
    const result = await evaluateAssessment(llm, claim, evidence, bad)
    expect(result.decision).toBe('REJECT')
    expect(result.hardRules.passed).toBe(false)
    expect(result.scores).toBeNull()
    expect(llm.requests).toHaveLength(0)
  })
})

describe('Evaluator integrity', () => {
  const ids = new Set(['e1', 'e2'])

  it('does not accept a model-supplied decision, invented evidence ids or bad scores', () => {
    expect(validateAudit(audit({}, { decision: 'ACCEPT' }), ids).ok).toBe(false)
    expect(validateAudit(audit({}, { findings: [{ dimension: 'grounding', message: 'x', evidenceIds: ['e99'] }] }), ids).ok).toBe(false)
    expect(validateAudit(audit({ grounding: 3 }), ids).ok).toBe(false)
    expect(validateAudit(audit({ grounding: 1.5 }), ids).ok).toBe(false)
    expect(validateAudit({ ...audit({}), scores: { evidenceQuality: 2 } }, ids).ok).toBe(false)
    expect(validateAudit(audit({}, { findings: [{ dimension: 'grounding', message: 'ok', evidenceIds: ['e1'] }] }), ids).ok).toBe(true)
  })

  it('retries invalid audits within the bound, then fails explicitly', async () => {
    const llm = scriptedLlm({ nonsense: true })
    await expect(evaluateAssessment(llm, claim, evidence, assessment(), { maxRetries: 1 })).rejects.toMatchObject({ kind: 'MALFORMED_OUTPUT' })
    expect(llm.requests).toHaveLength(2)
  })

  it('does not alter the evidence or assessment it was given', async () => {
    const input = assessment()
    const snapshot = JSON.stringify({ input, evidence })
    await evaluateAssessment(scriptedLlm(audit({})), claim, evidence, input)
    expect(JSON.stringify({ input, evidence })).toBe(snapshot)
  })
})
