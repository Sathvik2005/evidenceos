import { describe, expect, it } from 'vitest'
import {
  buildLedger, decide, RULES, validateAssessmentRules, validateEvidenceRecord, validateStateChange,
  type AssessableEvidence, type EvidenceRecord, type RuleId, type RuleResult,
} from '../../src/validation/rules'

const rulesOf = (r: RuleResult): RuleId[] => r.violations.map((v) => v.rule)

const goodRecord: EvidenceRecord = {
  id: 'e1', claimId: 'c1', sourceUrl: 'https://example.org/a', sourceTitle: 'A study', sourceType: 'JOURNAL_ARTICLE',
  retrievedAt: '2026-01-01T00:00:00.000Z', excerpt: 'scores fell by four points.', relationship: 'SUPPORTS', strength: 'MODERATE',
}
const ledger = buildLedger([{ url: 'https://example.org/a', text: 'Overall, scores fell   by four points. Next topic.' }])

describe('evidence record rules (failure injection)', () => {
  it('passes a well-formed, retrieved record', () => {
    expect(validateEvidenceRecord(goodRecord, 'c1', ledger).passed).toBe(true)
  })

  it.each<[string, Partial<EvidenceRecord>, RuleId]>([
    ['missing claim', { claimId: null }, RULES.EVIDENCE_CLAIM_MISSING],
    ['other claim', { claimId: 'c2' }, RULES.EVIDENCE_CLAIM_MISMATCH],
    ['no source url', { sourceUrl: null }, RULES.EVIDENCE_SOURCE_MISSING],
    ['bad source url', { sourceUrl: 'not a url' }, RULES.EVIDENCE_SOURCE_MISSING],
    ['empty excerpt', { excerpt: '  ' }, RULES.EVIDENCE_EXCERPT_MISSING],
    ['bad relationship', { relationship: 'PROVES' }, RULES.EVIDENCE_ENUM_INVALID],
    ['bad strength', { strength: 'HUGE' }, RULES.EVIDENCE_ENUM_INVALID],
    ['no title', { sourceTitle: '' }, RULES.PROVENANCE_MISSING],
    ['no retrieval time', { retrievedAt: null }, RULES.PROVENANCE_MISSING],
    ['fabricated source', { sourceUrl: 'https://made-up.example/x' }, RULES.FABRICATED_SOURCE],
    ['fabricated excerpt', { excerpt: 'Scores rose by forty points.' }, RULES.FABRICATED_EXCERPT],
  ])('rejects %s', (_label, patch, rule) => {
    expect(rulesOf(validateEvidenceRecord({ ...goodRecord, ...patch }, 'c1', ledger))).toContain(rule)
  })
})

const ev = (id: string, relationship: AssessableEvidence['relationship'], strength: AssessableEvidence['strength'] = 'MODERATE', claimId = 'c1'): AssessableEvidence => ({
  id, claimId, relationship, strength,
})
const assessment = (patch: Record<string, unknown> = {}) => ({
  claimId: 'c1', proposedState: 'SUPPORTED' as const, confidence: 'MEDIUM' as const, evidenceIds: ['e1'],
  causalStatus: 'CORRELATION' as const, ...patch,
})

describe('assessment rules (failure injection)', () => {
  it('accepts justified states', () => {
    expect(validateAssessmentRules(assessment(), [ev('e1', 'SUPPORTS')]).passed).toBe(true)
    expect(validateAssessmentRules(assessment({ proposedState: 'CONFLICTING', evidenceIds: ['e1', 'e2'] }), [ev('e1', 'SUPPORTS'), ev('e2', 'CONTRADICTS')]).passed).toBe(true)
    expect(validateAssessmentRules(assessment({ proposedState: 'INSUFFICIENT', evidenceIds: [] }), []).passed).toBe(true)
  })

  it('INSUFFICIENT stays allowed even with supporting evidence (conservative)', () => {
    expect(validateAssessmentRules(assessment({ proposedState: 'INSUFFICIENT' }), [ev('e1', 'SUPPORTS', 'STRONG')]).passed).toBe(true)
  })

  it.each<[string, ReturnType<typeof assessment>, AssessableEvidence[], RuleId]>([
    ['SUPPORTED with no evidence', assessment({ evidenceIds: [] }), [], RULES.SUPPORTED_WITHOUT_SUPPORT],
    ['SUPPORTED with only partial support', assessment(), [ev('e1', 'PARTIALLY_SUPPORTS')], RULES.SUPPORTED_WITHOUT_SUPPORT],
    ['SUPPORTED despite a material contradiction', assessment({ evidenceIds: ['e1', 'e2'] }), [ev('e1', 'SUPPORTS'), ev('e2', 'CONTRADICTS', 'STRONG')], RULES.SUPPORTED_DESPITE_CONTRADICTION],
    ['PARTIALLY_SUPPORTED with no support', assessment({ proposedState: 'PARTIALLY_SUPPORTED' }), [ev('e1', 'CONTRADICTS')], RULES.PARTIAL_WITHOUT_SUPPORT],
    ['CONFLICTING with one side only', assessment({ proposedState: 'CONFLICTING' }), [ev('e1', 'SUPPORTS')], RULES.CONFLICT_WITHOUT_BOTH_SIDES],
    ['omitted contradiction', assessment({ proposedState: 'PARTIALLY_SUPPORTED' }), [ev('e1', 'SUPPORTS'), ev('e2', 'CONTRADICTS', 'WEAK')], RULES.CONTRADICTION_OMITTED],
    ['unknown cited evidence', assessment({ evidenceIds: ['e1', 'ghost'] }), [ev('e1', 'SUPPORTS')], RULES.CITED_EVIDENCE_UNKNOWN],
    ['evidence from another claim', assessment({ evidenceIds: ['e1', 'x1'] }), [ev('e1', 'SUPPORTS'), ev('x1', 'SUPPORTS', 'STRONG', 'c2')], RULES.CITED_EVIDENCE_FOREIGN_CLAIM],
    ['HIGH confidence on weak evidence', assessment({ confidence: 'HIGH' }), [ev('e1', 'SUPPORTS', 'WEAK')], RULES.CONFIDENCE_UNSUPPORTED],
    ['causation without strong evidence', assessment({ causalStatus: 'CAUSATION' }), [ev('e1', 'SUPPORTS', 'MODERATE')], RULES.CAUSATION_UNSUPPORTED],
    ['invalid state', assessment({ proposedState: 'TRUE' }), [ev('e1', 'SUPPORTS')], RULES.STATE_INVALID],
  ])('rejects %s', (_label, subject, evidence, rule) => {
    expect(rulesOf(validateAssessmentRules(subject, evidence))).toContain(rule)
  })
})

describe('state-change rules (failure injection)', () => {
  const base = { claimId: 'c1', persistedState: 'PARTIALLY_SUPPORTED' as const, previousState: 'PARTIALLY_SUPPORTED' as const, newState: 'CONFLICTING' as const, triggeringEvidence: { id: 'e9', claimId: 'c1' } }

  it('accepts a real, evidence-backed transition', () => {
    expect(validateStateChange(base).passed).toBe(true)
  })

  it.each<[string, Partial<typeof base> & { triggeringEvidence?: null | { id: string; claimId: string } }, RuleId]>([
    ['stale previous state', { persistedState: 'SUPPORTED' }, RULES.CHANGE_NO_PREVIOUS_MATCH],
    ['no difference', { newState: 'PARTIALLY_SUPPORTED' }, RULES.CHANGE_NO_DIFFERENCE],
    ['no trigger', { triggeringEvidence: null }, RULES.CHANGE_TRIGGER_MISSING],
    ['trigger from another claim', { triggeringEvidence: { id: 'e9', claimId: 'c2' } }, RULES.CHANGE_TRIGGER_FOREIGN_CLAIM],
  ])('rejects %s', (_label, patch, rule) => {
    expect(rulesOf(validateStateChange({ ...base, ...patch } as never))).toContain(rule)
  })
})

describe('hard rules override the evaluator', () => {
  it('rejects when a hard rule fails even if the evaluator accepts', () => {
    const failed = validateAssessmentRules(assessment({ evidenceIds: [] }), [])
    expect(decide(failed, true)).toBe('REJECT')
    expect(decide({ passed: true, violations: [] }, false)).toBe('REJECT')
    expect(decide({ passed: true, violations: [] }, true)).toBe('ACCEPT')
  })
})
