// Deterministic validation layer (Prompt 09). These are HARD rules: no LLM judgment can
// override a violation. Every check returns structured violations instead of throwing.
import {
  CLAIM_STATES, EVIDENCE_RELATIONSHIPS, EVIDENCE_STRENGTHS, SOURCE_TYPES,
  type ClaimState, type EvidenceRelationship, type EvidenceStrength, type SourceType,
} from '../api/contracts'
import type { EvidenceAssessment } from '../agents/evidenceAnalyst'
import { normalizeUrl } from '../agents/researchAgent'

export const RULES = {
  EVIDENCE_CLAIM_MISSING: 'EVIDENCE_CLAIM_MISSING',
  EVIDENCE_CLAIM_MISMATCH: 'EVIDENCE_CLAIM_MISMATCH',
  EVIDENCE_SOURCE_MISSING: 'EVIDENCE_SOURCE_MISSING',
  EVIDENCE_EXCERPT_MISSING: 'EVIDENCE_EXCERPT_MISSING',
  EVIDENCE_ENUM_INVALID: 'EVIDENCE_ENUM_INVALID',
  PROVENANCE_MISSING: 'PROVENANCE_MISSING',
  FABRICATED_SOURCE: 'FABRICATED_SOURCE',
  FABRICATED_EXCERPT: 'FABRICATED_EXCERPT',
  STATE_INVALID: 'STATE_INVALID',
  SUPPORTED_WITHOUT_SUPPORT: 'SUPPORTED_WITHOUT_SUPPORT',
  SUPPORTED_DESPITE_CONTRADICTION: 'SUPPORTED_DESPITE_CONTRADICTION',
  PARTIAL_WITHOUT_SUPPORT: 'PARTIAL_WITHOUT_SUPPORT',
  CONFLICT_WITHOUT_BOTH_SIDES: 'CONFLICT_WITHOUT_BOTH_SIDES',
  CONTRADICTION_OMITTED: 'CONTRADICTION_OMITTED',
  CITED_EVIDENCE_UNKNOWN: 'CITED_EVIDENCE_UNKNOWN',
  CITED_EVIDENCE_FOREIGN_CLAIM: 'CITED_EVIDENCE_FOREIGN_CLAIM',
  CONFIDENCE_UNSUPPORTED: 'CONFIDENCE_UNSUPPORTED',
  CAUSATION_UNSUPPORTED: 'CAUSATION_UNSUPPORTED',
  CHANGE_PREVIOUS_MISSING: 'CHANGE_PREVIOUS_MISSING',
  CHANGE_NO_PREVIOUS_MATCH: 'CHANGE_NO_PREVIOUS_MATCH',
  CHANGE_TRIGGER_NOT_NEW: 'CHANGE_TRIGGER_NOT_NEW',
  CHANGE_NO_DIFFERENCE: 'CHANGE_NO_DIFFERENCE',
  CHANGE_TRIGGER_MISSING: 'CHANGE_TRIGGER_MISSING',
  CHANGE_TRIGGER_FOREIGN_CLAIM: 'CHANGE_TRIGGER_FOREIGN_CLAIM',
} as const
export type RuleId = (typeof RULES)[keyof typeof RULES]

export interface Violation {
  readonly rule: RuleId
  readonly message: string
  readonly subject?: string
}

export interface RuleResult {
  readonly passed: boolean
  readonly violations: readonly Violation[]
}

const result = (violations: Violation[]): RuleResult => ({ passed: violations.length === 0, violations })
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** What the retrieval step actually returned for this run; the ground truth for provenance checks. */
export type RetrievalLedger = ReadonlyMap<string, string>

export function buildLedger(documents: readonly { url: string; text: string }[]): RetrievalLedger {
  const ledger = new Map<string, string>()
  for (const doc of documents) {
    const url = normalizeUrl(doc.url)
    if (url) ledger.set(url, collapse(doc.text))
  }
  return ledger
}

export interface EvidenceRecord {
  readonly id: string
  readonly claimId: string | null
  readonly sourceUrl: string | null
  readonly sourceTitle: string | null
  readonly sourceType: SourceType | null
  readonly retrievedAt: string | null
  readonly excerpt: string | null
  readonly relationship: string
  readonly strength: string
}

/** Rules for one evidence record against its claim, and (when given) the retrieval ledger. */
export function validateEvidenceRecord(
  evidence: EvidenceRecord,
  claimId: string,
  ledger?: RetrievalLedger,
): RuleResult {
  const v: Violation[] = []
  const subject = evidence.id
  if (!evidence.claimId) v.push({ rule: RULES.EVIDENCE_CLAIM_MISSING, message: 'Evidence has no claim.', subject })
  else if (evidence.claimId !== claimId) {
    v.push({ rule: RULES.EVIDENCE_CLAIM_MISMATCH, message: 'Evidence belongs to a different claim.', subject })
  }
  if (!evidence.sourceUrl || !normalizeUrl(evidence.sourceUrl)) {
    v.push({ rule: RULES.EVIDENCE_SOURCE_MISSING, message: 'Evidence has no valid source URL.', subject })
  }
  if (!evidence.excerpt || !collapse(evidence.excerpt)) {
    v.push({ rule: RULES.EVIDENCE_EXCERPT_MISSING, message: 'Evidence has no excerpt.', subject })
  }
  if (
    !EVIDENCE_RELATIONSHIPS.includes(evidence.relationship as EvidenceRelationship) ||
    !EVIDENCE_STRENGTHS.includes(evidence.strength as EvidenceStrength)
  ) {
    v.push({ rule: RULES.EVIDENCE_ENUM_INVALID, message: 'Relationship or strength is invalid.', subject })
  }
  if (
    !evidence.sourceTitle?.trim() ||
    !evidence.retrievedAt ||
    Number.isNaN(Date.parse(evidence.retrievedAt)) ||
    !SOURCE_TYPES.includes(evidence.sourceType as SourceType)
  ) {
    v.push({ rule: RULES.PROVENANCE_MISSING, message: 'Title, source type or retrieval time is missing.', subject })
  }

  if (ledger && evidence.sourceUrl) {
    const text = ledger.get(normalizeUrl(evidence.sourceUrl) ?? '')
    if (text === undefined) {
      v.push({ rule: RULES.FABRICATED_SOURCE, message: 'Source was not returned by retrieval.', subject })
    } else if (evidence.excerpt && !text.includes(collapse(evidence.excerpt))) {
      v.push({ rule: RULES.FABRICATED_EXCERPT, message: 'Excerpt is not present in the retrieved source.', subject })
    }
  }
  return result(v)
}

export interface AssessableEvidence {
  readonly id: string
  readonly claimId: string
  readonly relationship: EvidenceRelationship
  readonly strength: EvidenceStrength
}

/** State/confidence semantics: the proposed state must be justified by the persisted evidence. */
export function validateAssessmentRules(
  assessment: Pick<EvidenceAssessment, 'claimId' | 'proposedState' | 'confidence' | 'evidenceIds' | 'causalStatus'>,
  evidence: readonly AssessableEvidence[],
): RuleResult {
  const v: Violation[] = []
  const byId = new Map(evidence.map((e) => [e.id, e]))
  const claimEvidence = evidence.filter((e) => e.claimId === assessment.claimId)

  if (!CLAIM_STATES.includes(assessment.proposedState)) {
    v.push({ rule: RULES.STATE_INVALID, message: 'State is not an allowed claim state.' })
    return result(v)
  }

  for (const id of assessment.evidenceIds) {
    const item = byId.get(id)
    if (!item) v.push({ rule: RULES.CITED_EVIDENCE_UNKNOWN, message: 'Cited evidence does not exist.', subject: id })
    else if (item.claimId !== assessment.claimId) {
      v.push({ rule: RULES.CITED_EVIDENCE_FOREIGN_CLAIM, message: 'Cited evidence belongs to another claim.', subject: id })
    }
  }

  const cited = new Set(assessment.evidenceIds)
  for (const item of claimEvidence) {
    if (item.relationship === 'CONTRADICTS' && !cited.has(item.id)) {
      v.push({ rule: RULES.CONTRADICTION_OMITTED, message: 'Contradicting evidence was not addressed.', subject: item.id })
    }
  }

  const counts = (relationships: EvidenceRelationship[], min?: EvidenceStrength[]) =>
    claimEvidence.filter((e) => relationships.includes(e.relationship) && (!min || min.includes(e.strength)))
  const supporting = counts(['SUPPORTS'])
  const partial = counts(['SUPPORTS', 'PARTIALLY_SUPPORTS'])
  const contradicting = counts(['CONTRADICTS'])
  const materialContradiction = counts(['CONTRADICTS'], ['STRONG', 'MODERATE'])

  switch (assessment.proposedState) {
    case 'SUPPORTED':
      if (supporting.length === 0) v.push({ rule: RULES.SUPPORTED_WITHOUT_SUPPORT, message: 'SUPPORTED requires supporting evidence.' })
      if (materialContradiction.length > 0) {
        v.push({ rule: RULES.SUPPORTED_DESPITE_CONTRADICTION, message: 'SUPPORTED is not allowed with material contradicting evidence.' })
      }
      break
    case 'PARTIALLY_SUPPORTED':
      if (partial.length === 0) v.push({ rule: RULES.PARTIAL_WITHOUT_SUPPORT, message: 'PARTIALLY_SUPPORTED requires supporting or partially supporting evidence.' })
      break
    case 'CONFLICTING':
      if (partial.length === 0 || contradicting.length === 0) {
        v.push({ rule: RULES.CONFLICT_WITHOUT_BOTH_SIDES, message: 'CONFLICTING requires both supporting and contradicting evidence.' })
      }
      break
    case 'INSUFFICIENT':
      // Always permitted: insufficiency is the conservative result.
      break
  }

  if (assessment.confidence === 'HIGH' && assessment.proposedState !== 'INSUFFICIENT') {
    const strong = claimEvidence.filter((e) => e.strength === 'STRONG' && e.relationship !== 'INSUFFICIENT')
    const moderateSupport = counts(['SUPPORTS'], ['MODERATE'])
    if (strong.length === 0 && moderateSupport.length < 2) {
      v.push({ rule: RULES.CONFIDENCE_UNSUPPORTED, message: 'HIGH confidence needs a STRONG item or two MODERATE supporting items.' })
    }
  }
  if (assessment.causalStatus === 'CAUSATION' && !assessment.evidenceIds.some((id) => byId.get(id)?.strength === 'STRONG')) {
    v.push({ rule: RULES.CAUSATION_UNSUPPORTED, message: 'Causal language requires at least one STRONG cited item.' })
  }
  return result(v)
}

export interface StateChangeCheck {
  readonly claimId: string
  readonly persistedState: ClaimState | null
  /** Null means the claim has no persisted state yet, so no change event may exist. */
  readonly previousState: ClaimState | null
  readonly newState: ClaimState
  readonly triggeringEvidence: { readonly id: string; readonly claimId: string } | null
  /** True when the trigger was not part of the evidence known before this run. */
  readonly triggerIsNew?: boolean
}

/** A change event needs a real previous state, a real difference and a real trigger for this claim. */
export function validateStateChange(change: StateChangeCheck): RuleResult {
  const v: Violation[] = []
  if (!CLAIM_STATES.includes(change.newState)) v.push({ rule: RULES.STATE_INVALID, message: 'New state is invalid.' })
  if (change.previousState === null) {
    v.push({ rule: RULES.CHANGE_PREVIOUS_MISSING, message: 'A change needs a persisted previous state; a first assessment is not a change.' })
  }
  if (change.previousState !== change.persistedState) {
    v.push({ rule: RULES.CHANGE_NO_PREVIOUS_MATCH, message: 'Previous state does not match the persisted state.' })
  }
  if (change.previousState === change.newState) {
    v.push({ rule: RULES.CHANGE_NO_DIFFERENCE, message: 'There is no meaningful state difference.' })
  }
  if (!change.triggeringEvidence) {
    v.push({ rule: RULES.CHANGE_TRIGGER_MISSING, message: 'A state change needs triggering evidence.' })
  } else if (change.triggeringEvidence.claimId !== change.claimId) {
    v.push({ rule: RULES.CHANGE_TRIGGER_FOREIGN_CLAIM, message: 'Triggering evidence belongs to another claim.', subject: change.triggeringEvidence.id })
  } else if (change.triggerIsNew === false) {
    v.push({ rule: RULES.CHANGE_TRIGGER_NOT_NEW, message: 'A state change must be triggered by evidence new to this run.', subject: change.triggeringEvidence.id })
  }
  return result(v)
}

export type Decision = 'ACCEPT' | 'REJECT'

/** Hard rules are final: an LLM/Evaluator "accept" can never override a violation. */
export function decide(hard: RuleResult, evaluatorAccepts: boolean): Decision {
  return hard.passed && evaluatorAccepts ? 'ACCEPT' : 'REJECT'
}
