// Seed data for the demo. It is real persisted data written through the same operations and hard
// rules as live runs: the sources and quotes come from demo/corpus.json (verified verbatim), and
// every state change goes through the change rules. What a seed does NOT contain is model output:
// the claims, relationships and reasons below were written by the authors and are labelled as such.
import {
  addClaim, addEvidence, addSource, createInvestigation, listClaims, listEvidence, recordClaimAssessment,
  recordStateChange, setInvestigationStatus, type Database,
} from '../api/operations'
import type { ClaimState, ConfidenceLevel, EvidenceRelationship, EvidenceStrength } from '../api/contracts'
import { normalizeUrl } from '../agents/researchAgent'
import { buildLedger, validateAssessmentRules, validateEvidenceRecord, validateStateChange } from '../validation/rules'
import type { RecordedDocument } from './adapters/recorded'

export const SEED_QUESTION = 'Does remote learning improve student outcomes?'
export const SEED_NOTE = 'Seed fixture (authored, not model output):'

interface SeedEvidence {
  readonly phase: 1 | 2
  readonly claim: 1 | 2
  readonly urlIncludes: string
  readonly relationship: EvidenceRelationship
  readonly strength: EvidenceStrength
  readonly reasoning: string
}

const CLAIMS = [
  'Remote learning improves academic outcomes compared with in-person instruction',
  'Remote learning improves student engagement',
] as const

const EVIDENCE: readonly SeedEvidence[] = [
  { phase: 1, claim: 1, urlIncludes: 'sri.com', relationship: 'PARTIALLY_SUPPORTS', strength: 'MODERATE',
    reasoning: 'A pre-pandemic meta-analysis of online conditions (1996-2008); it does not cover emergency remote teaching.' },
  { phase: 2, claim: 1, urlIncludes: 'educationnext.org', relationship: 'CONTRADICTS', strength: 'MODERATE',
    reasoning: 'A randomized college experiment (2020 cohort): online instruction lowered final grades.' },
  { phase: 2, claim: 1, urlIncludes: 'nber.org', relationship: 'CONTRADICTS', strength: 'MODERATE',
    reasoning: 'District-level data: more remote schooling was associated with larger test-score declines (association, not a randomized result).' },
]

const ASSESSMENT: Record<number, { state: ClaimState; confidence: ConfidenceLevel; reason: string }> = {
  1: { state: 'PARTIALLY_SUPPORTED', confidence: 'LOW', reason: `${SEED_NOTE} one older, pre-pandemic synthesis leans slightly toward online learning; its scope differs from the claim.` },
  2: { state: 'CONFLICTING', confidence: 'MEDIUM', reason: `${SEED_NOTE} new evidence from a randomized experiment and from district test data contradicts the earlier, weaker support.` },
}
const NO_EVIDENCE = `${SEED_NOTE} no retained evidence addresses this claim.`

function documentFor(corpus: readonly RecordedDocument[], needle: string): RecordedDocument {
  const found = corpus.find((d) => d.url.includes(needle))
  if (!found) throw new Error(`Seed corpus has no document matching ${needle}.`)
  return found
}

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: { message: string } }, what: string): T {
  if (!result.ok) throw new Error(`Seed failed at ${what}: ${result.error.message}`)
  return result.data
}

async function persistEvidence(db: Database, owner: string, investigationId: string, claimIds: readonly string[], phase: 1 | 2, corpus: readonly RecordedDocument[]) {
  const ledger = buildLedger(corpus)
  const saved: { id: string; claimId: string; relationship: EvidenceRelationship }[] = []
  for (const item of EVIDENCE.filter((e) => e.phase === phase)) {
    const doc = documentFor(corpus, item.urlIncludes)
    const claimId = claimIds[item.claim - 1] ?? ''
    // Same hard rules as live evidence: provenance present and the quote exists in the retrieved text.
    const check = validateEvidenceRecord(
      { id: item.urlIncludes, claimId, sourceUrl: doc.url, sourceTitle: doc.title, sourceType: doc.sourceType, retrievedAt: doc.retrievedAt, excerpt: doc.text, relationship: item.relationship, strength: item.strength },
      claimId, ledger)
    if (!check.passed) throw new Error(`Seed evidence rejected: ${check.violations.map((v) => v.rule).join(', ')}`)

    const url = normalizeUrl(doc.url) ?? doc.url
    const source = unwrap(await addSource(db, owner, {
      investigationId, sourceType: doc.sourceType, url, title: doc.title,
      ...(doc.publisher ? { publisher: doc.publisher } : {}), ...(doc.publishedAt ? { publishedAt: doc.publishedAt } : {}),
      idempotencyKey: `seed:src:${item.urlIncludes}`,
    }), 'source')
    const evidence = unwrap(await addEvidence(db, owner, {
      investigationId, claimId, sourceId: source.id, relationship: item.relationship, strength: item.strength,
      excerpt: doc.text, reasoning: `${SEED_NOTE} ${item.reasoning}`, idempotencyKey: `seed:ev:${item.urlIncludes}`,
    }), 'evidence')
    saved.push({ id: evidence.id, claimId, relationship: evidence.relationship })
  }
  return saved
}

/** Stage 1: claims, the first evidence, and first assessments (stored directly; not state changes). */
export async function seedInitial(db: Database, owner: string, corpus: readonly RecordedDocument[]): Promise<string> {
  const created = unwrap(await createInvestigation(db, owner, { question: SEED_QUESTION, idempotencyKey: 'seed-v1' }), 'investigation')
  const claims = []
  for (const [index, statement] of CLAIMS.entries()) {
    claims.push(unwrap(await addClaim(db, owner, { investigationId: created.id, ordinal: index + 1, statement, idempotencyKey: `seed:claim:${index + 1}` }), 'claim'))
  }
  const claimIds = claims.map((c) => c.id)
  const evidence = await persistEvidence(db, owner, created.id, claimIds, 1, corpus)

  for (const [index, claim] of claims.entries()) {
    if (claim.state !== null) continue // already assessed: re-running the seed changes nothing
    const own = evidence.filter((e) => e.claimId === claim.id)
    const plan = index === 0 ? ASSESSMENT[1] : { state: 'INSUFFICIENT' as const, confidence: 'LOW' as const, reason: NO_EVIDENCE }
    if (!plan) throw new Error('Seed assessment missing.')
    const rules = validateAssessmentRules(
      { claimId: claim.id, proposedState: plan.state, confidence: plan.confidence, evidenceIds: own.map((e) => e.id), causalStatus: 'NOT_APPLICABLE' },
      own.map((e) => ({ id: e.id, claimId: e.claimId, relationship: e.relationship, strength: 'MODERATE' as const })))
    if (!rules.passed) throw new Error(`Seed assessment rejected: ${rules.violations.map((v) => v.rule).join(', ')}`)
    unwrap(await recordClaimAssessment(db, owner, { investigationId: created.id, claimId: claim.id, confidence: plan.confidence, reason: plan.reason, initialState: plan.state }), 'assessment')
  }
  unwrap(await setInvestigationStatus(db, owner, created.id, 'READY'), 'status')
  return created.id
}

/** Stage 2: new evidence arrives and the first claim changes state, recorded with its trigger. */
export async function seedAdvance(db: Database, owner: string, investigationId: string, corpus: readonly RecordedDocument[]): Promise<void> {
  const claims = unwrap(await listClaims(db, owner, investigationId), 'claims')
  const first = claims.find((c) => c.ordinal === 1)
  if (!first) throw new Error('Seed investigation has no first claim; run the initial seed first.')
  const prior = new Set(unwrap(await listEvidence(db, owner, investigationId), 'evidence').map((e) => e.id))

  const added = await persistEvidence(db, owner, investigationId, claims.map((c) => c.id), 2, corpus)
  const plan = ASSESSMENT[2]
  if (!plan) throw new Error('Seed assessment missing.')
  if (first.state === plan.state) return // already advanced: no meaningful difference, no new history

  const trigger = added.find((e) => e.claimId === first.id && e.relationship === 'CONTRADICTS' && !prior.has(e.id))
  const check = validateStateChange({
    claimId: first.id, persistedState: first.state, previousState: first.state, newState: plan.state,
    triggeringEvidence: trigger ? { id: trigger.id, claimId: trigger.claimId } : null, triggerIsNew: Boolean(trigger),
  })
  if (!check.passed || !first.state || !trigger) throw new Error(`Seed state change rejected: ${check.violations.map((v) => v.rule).join(', ')}`)

  unwrap(await recordStateChange(db, owner, {
    investigationId, claimId: first.id, previousState: first.state, newState: plan.state, reason: plan.reason,
    triggeringEvidenceId: trigger.id, idempotencyKey: `seed:change:${first.id}`,
  }), 'state change')
  unwrap(await recordClaimAssessment(db, owner, { investigationId, claimId: first.id, confidence: plan.confidence, reason: plan.reason }), 'assessment')
}
