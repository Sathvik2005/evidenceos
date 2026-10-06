// Real node handlers for the investigation workflow (Prompt 11). Each node does one job,
// persists through the typed API, and records explicit failures instead of hiding them.
import {
  addClaim, addEvidence, addSource, getInvestigation, listClaims, recordClaimAssessment,
  recordStateChange, setInvestigationStatus, type Database,
} from '../api/operations'
import type { ApiResult } from '../api/contracts'
import { claimProblems, decomposeClaims } from '../agents/claimDecomposer'
import { analyzeEvidence, type AnalystEvidence } from '../agents/evidenceAnalyst'
import { evaluateAssessment } from '../agents/evaluator'
import type { LlmClient } from '../agents/llm'
import { normalizeUrl, researchClaim, type SearchProvider } from '../agents/researchAgent'
import { validateAssessmentRules, validateEvidenceRecord, validateStateChange, type RetrievalLedger } from '../validation/rules'
import {
  WorkflowError, type ClaimOutcome, type FailureKind, type NodeHandlers, type WorkflowFailure,
  type WorkflowNode, type WorkflowSnapshot,
} from './types'

export interface WorkflowDeps {
  readonly db: Database
  readonly llm: LlmClient
  readonly search: SearchProvider
  readonly maxRetries?: number
}

const FATAL: ReadonlySet<FailureKind> = new Set(['AUTHENTICATION', 'AUTHORIZATION'])
const MAX_PAGE = { limit: 100 }

/** Stable 32-bit FNV-1a hash, used only to build deterministic idempotency keys. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function unwrap<T>(result: ApiResult<T>): T {
  if (result.ok) return result.data
  const { code, message } = result.error
  const kind: FailureKind =
    code === 'VALIDATION_FAILED' || code === 'REFERENCE_INVALID' || code === 'CONSTRAINT_VIOLATION' ? 'VALIDATION'
    : code === 'NOT_FOUND' ? 'AUTHORIZATION'
    : 'PERSISTENCE'
  throw new WorkflowError(kind, message)
}

function failure(node: WorkflowNode, kind: FailureKind, message: string, claimId?: string): WorkflowFailure {
  return claimId === undefined ? { node, kind, message } : { node, kind, message, claimId }
}

function kindOf(error: unknown): FailureKind {
  return error instanceof WorkflowError ? error.kind : 'WORKFLOW'
}

/** Runs one task per claim in parallel; a non-fatal failure on one claim never discards the others. */
async function forEachClaim<T>(
  node: WorkflowNode,
  claims: readonly { id: string }[],
  task: (claim: { id: string }) => Promise<T>,
): Promise<{ results: [string, T][]; failures: WorkflowFailure[] }> {
  const settled = await Promise.all(
    claims.map(async (claim) => {
      try {
        return { claim, value: await task(claim) }
      } catch (error) {
        if (FATAL.has(kindOf(error))) throw error
        return { claim, error }
      }
    }),
  )
  const results: [string, T][] = []
  const failures: WorkflowFailure[] = []
  for (const entry of settled) {
    if ('error' in entry) {
      const message = entry.error instanceof WorkflowError ? entry.error.message : 'Unexpected failure.'
      failures.push(failure(node, kindOf(entry.error), message, entry.claim.id))
    } else results.push([entry.claim.id, entry.value])
  }
  return { results, failures }
}

const toRecord = <T>(entries: [string, T][]): Record<string, T> => Object.fromEntries(entries)
const researchUnavailable = (state: WorkflowSnapshot, claimId: string) =>
  state.failures.some((f) => f.node === 'research' && f.claimId === claimId && f.message.startsWith('Research unavailable'))

export function createWorkflowHandlers(deps: WorkflowDeps): NodeHandlers {
  const { db, llm, search, maxRetries } = deps
  const retryOptions = maxRetries === undefined ? {} : { maxRetries }

  return {
    async load(state) {
      const investigation = unwrap(await getInvestigation(db, state.ownerId, state.investigationId))
      const claims = unwrap(await listClaims(db, state.ownerId, state.investigationId, MAX_PAGE))
      return {
        question: investigation.question,
        claims: claims.map((c) => ({ id: c.id, ordinal: c.ordinal, statement: c.statement, state: c.state })),
      }
    },

    async decompose(state) {
      // Idempotent: claims that already exist are reused, never re-generated.
      if (state.claims.length > 0) return {}
      const result = await decomposeClaims(llm, { investigationId: state.investigationId, question: state.question }, retryOptions)
      return { claims: result.claims.map((c) => ({ id: '', ordinal: c.ordinal, statement: c.statement, state: null })) }
    },

    async validateClaims(state) {
      if (state.claims.length === 0) throw new WorkflowError('VALIDATION', 'No claims were produced.')
      const ordinals = new Set<number>()
      for (const claim of state.claims) {
        if (ordinals.has(claim.ordinal)) throw new WorkflowError('VALIDATION', 'Duplicate claim ordinal.')
        ordinals.add(claim.ordinal)
        if (claim.id === '') {
          const problems = claimProblems(claim.statement)
          if (problems.length > 0) throw new WorkflowError('VALIDATION', `Claim ${claim.ordinal} is invalid: ${problems.join('; ')}`)
        }
      }
      return {}
    },

    async persistClaims(state) {
      const claims = []
      for (const claim of state.claims) {
        if (claim.id !== '') {
          claims.push(claim)
          continue
        }
        const saved = unwrap(await addClaim(db, state.ownerId, {
          investigationId: state.investigationId, ordinal: claim.ordinal, statement: claim.statement,
          idempotencyKey: `claim:${claim.ordinal}`,
        }))
        claims.push({ id: saved.id, ordinal: saved.ordinal, statement: saved.statement, state: saved.state })
      }
      return { claims }
    },

    async research(state) {
      unwrap(await setInvestigationStatus(db, state.ownerId, state.investigationId, 'RESEARCHING'))
      const { results, failures } = await forEachClaim('research', state.claims, async (claim) => {
        const full = state.claims.find((c) => c.id === claim.id)
        return researchClaim({ llm, search }, { id: claim.id, statement: full?.statement ?? '' }, retryOptions)
      })
      const extra: WorkflowFailure[] = []
      const ledger: Record<string, string> = {}
      for (const [claimId, result] of results) {
        for (const doc of result.retrieved) ledger[doc.url] = doc.text
        if (result.status === 'UNAVAILABLE') extra.push(failure('research', 'NETWORK', 'Research unavailable: sources could not be retrieved.', claimId))
        else if (result.status === 'PARTIAL') extra.push(failure('research', 'NETWORK', 'Research partial: some sources were unavailable.', claimId))
      }
      return {
        evidenceByClaim: toRecord(results.map(([id, r]) => [id, r.candidates])),
        ledger,
        failures: [...failures, ...extra],
      }
    },

    async validateEvidence(state) {
      const ledger: RetrievalLedger = new Map(Object.entries(state.ledger))
      const failures: WorkflowFailure[] = []
      const persisted: Record<string, (AnalystEvidence & { claimId: string })[]> = {}

      for (const claim of state.claims) {
        const kept: (AnalystEvidence & { claimId: string })[] = []
        const candidates = state.evidenceByClaim[claim.id] ?? []
        for (const [index, candidate] of candidates.entries()) {
          const check = validateEvidenceRecord(
            {
              id: `${claim.id}#${index}`, claimId: claim.id, sourceUrl: candidate.sourceUrl, sourceTitle: candidate.sourceTitle,
              sourceType: candidate.sourceType, retrievedAt: candidate.retrievedAt, excerpt: candidate.excerpt,
              relationship: candidate.relationship, strength: candidate.strength,
            },
            claim.id,
            ledger,
          )
          if (!check.passed) {
            failures.push(failure('validateEvidence', 'VALIDATION', `Evidence rejected: ${check.violations.map((v) => v.rule).join(', ')}`, claim.id))
            continue
          }
          try {
            const url = normalizeUrl(candidate.sourceUrl) ?? candidate.sourceUrl
            const source = unwrap(await addSource(db, state.ownerId, {
              investigationId: state.investigationId, sourceType: candidate.sourceType, url,
              title: candidate.sourceTitle,
              ...(candidate.publisher ? { publisher: candidate.publisher } : {}),
              ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
              idempotencyKey: `src:${fnv1a(url)}`,
            }))
            const evidence = unwrap(await addEvidence(db, state.ownerId, {
              investigationId: state.investigationId, claimId: claim.id, sourceId: source.id,
              relationship: candidate.relationship, strength: candidate.strength, excerpt: candidate.excerpt,
              idempotencyKey: `ev:${claim.id}:${fnv1a(`${url}|${candidate.excerpt}`)}`,
            }))
            kept.push({
              id: evidence.id, claimId: claim.id, sourceTitle: source.title, sourceUrl: source.url,
              publishedAt: source.publishedAt, excerpt: evidence.excerpt,
              relationship: evidence.relationship, strength: evidence.strength,
            })
          } catch (error) {
            if (FATAL.has(kindOf(error))) throw error
            failures.push(failure('validateEvidence', kindOf(error), error instanceof WorkflowError ? error.message : 'Evidence could not be persisted.', claim.id))
          }
        }
        persisted[claim.id] = kept
      }
      return { persistedEvidence: persisted, failures }
    },

    async analyze(state) {
      unwrap(await setInvestigationStatus(db, state.ownerId, state.investigationId, 'ANALYZING'))
      const claims = state.claims.filter((c) => !researchUnavailable(state, c.id))
      const { results, failures } = await forEachClaim('analyze', claims, async (claim) => {
        const full = state.claims.find((c) => c.id === claim.id)
        return analyzeEvidence(llm, { id: claim.id, statement: full?.statement ?? '' }, state.persistedEvidence[claim.id] ?? [], retryOptions)
      })
      return { assessments: toRecord(results), failures }
    },

    async validateAssessment(state) {
      const failures: WorkflowFailure[] = []
      for (const [claimId, assessment] of Object.entries(state.assessments)) {
        const check = validateAssessmentRules(assessment, state.persistedEvidence[claimId] ?? [])
        if (!check.passed) {
          failures.push(failure('validateAssessment', 'VALIDATION', `Assessment violates: ${check.violations.map((v) => v.rule).join(', ')}`, claimId))
        }
      }
      return { failures }
    },

    async evaluate(state) {
      const claims = state.claims.filter((c) => state.assessments[c.id])
      const { results, failures } = await forEachClaim('evaluate', claims, async (claim) => {
        const full = state.claims.find((c) => c.id === claim.id)
        const assessment = state.assessments[claim.id]
        if (!assessment) throw new WorkflowError('WORKFLOW', 'Missing assessment.')
        return evaluateAssessment(llm, { id: claim.id, statement: full?.statement ?? '' }, state.persistedEvidence[claim.id] ?? [], assessment, retryOptions)
      })
      return { evaluations: toRecord(results), failures }
    },

    async decide(state) {
      const outcomes: Record<string, ClaimOutcome> = {}
      const failures: WorkflowFailure[] = []
      for (const [claimId, evaluation] of Object.entries(state.evaluations)) {
        const assessment = state.assessments[claimId]
        if (evaluation.decision === 'ACCEPT' && assessment) {
          outcomes[claimId] = { claimId, state: assessment.proposedState, confidence: assessment.confidence }
        } else if (evaluation.hardRules.passed) {
          failures.push(failure('decide', 'VALIDATION', 'Assessment was not accepted by the evaluation audit.', claimId))
        }
      }
      return { outcomes, failures }
    },

    async persistState(state) {
      const failures: WorkflowFailure[] = []
      for (const outcome of Object.values(state.outcomes)) {
        const assessment = state.assessments[outcome.claimId]
        // No retained evidence means no state can be recorded (history needs a trigger), so do not
        // persist a lone confidence either: the claim stays visibly unassessed.
        if (!assessment || (state.persistedEvidence[outcome.claimId] ?? []).length === 0) continue
        try {
          unwrap(await recordClaimAssessment(db, state.ownerId, {
            investigationId: state.investigationId, claimId: outcome.claimId,
            confidence: outcome.confidence, reason: assessment.rationale,
          }))
        } catch (error) {
          if (FATAL.has(kindOf(error))) throw error
          failures.push(failure('persistState', kindOf(error), 'Assessment could not be persisted.', outcome.claimId))
        }
      }
      return { failures }
    },

    async detectChange(state) {
      const failures: WorkflowFailure[] = []
      for (const outcome of Object.values(state.outcomes)) {
        const claim = state.claims.find((c) => c.id === outcome.claimId)
        const assessment = state.assessments[outcome.claimId]
        if (!claim || !assessment || claim.state === outcome.state) continue // no meaningful difference: no event

        const evidence = state.persistedEvidence[claim.id] ?? []
        const trigger = evidence.find((e) => assessment.evidenceIds.includes(e.id)) ?? null
        const check = validateStateChange({
          claimId: claim.id, persistedState: claim.state, previousState: claim.state, newState: outcome.state,
          triggeringEvidence: trigger ? { id: trigger.id, claimId: trigger.claimId } : null,
        })
        if (!check.passed) {
          // e.g. INSUFFICIENT with no evidence cannot be recorded: the history requires a trigger.
          failures.push(failure('detectChange', 'VALIDATION', `State change not recorded: ${check.violations.map((v) => v.rule).join(', ')}`, claim.id))
          continue
        }
        try {
          unwrap(await recordStateChange(db, state.ownerId, {
            investigationId: state.investigationId, claimId: claim.id, previousState: claim.state, newState: outcome.state,
            reason: assessment.rationale, triggeringEvidenceId: trigger?.id ?? '',
            idempotencyKey: `chg:${claim.id}:${claim.state ?? 'NONE'}>${outcome.state}`,
          }))
        } catch (error) {
          if (FATAL.has(kindOf(error))) throw error
          failures.push(failure('detectChange', kindOf(error), 'State change could not be persisted.', claim.id))
        }
      }
      return { failures }
    },

    async summarize(state) {
      // Only outcomes backed by retained evidence are recorded in history; the rest stay unresolved.
      const recorded = Object.values(state.outcomes).filter((o) => (state.persistedEvidence[o.claimId] ?? []).length > 0)
      const counts = new Map<string, number>()
      for (const outcome of recorded) counts.set(outcome.state, (counts.get(outcome.state) ?? 0) + 1)
      const unresolved = state.claims.length - recorded.length
      const parts = [...counts.entries()].map(([name, n]) => `${n} ${name}`)
      const summary = `${state.claims.length} claims: ${parts.join(', ') || 'none assessed'}${unresolved > 0 ? `; ${unresolved} unresolved` : ''}.`
      const complete = unresolved === 0 && state.failures.length === 0
      unwrap(await setInvestigationStatus(db, state.ownerId, state.investigationId, complete ? 'READY' : 'REVIEW_REQUIRED'))
      return { summary }
    },
  }
}
