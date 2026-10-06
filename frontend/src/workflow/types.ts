// Typed, serializable workflow contracts (Prompt 05). Domain enums come from the API contracts.
import type { ClaimState, ConfidenceLevel, EvidenceRelationship, EvidenceStrength } from '../api/contracts'

export const WORKFLOW_NODES = [
  'load',
  'decompose',
  'validateClaims',
  'persistClaims',
  'research',
  'validateEvidence',
  'analyze',
  'validateAssessment',
  'evaluate',
  'decide',
  'persistState',
  'detectChange',
  'summarize',
] as const
export type WorkflowNode = (typeof WORKFLOW_NODES)[number]

export type WorkflowStatus = 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED'

export type FailureKind =
  | 'VALIDATION'
  | 'PROVIDER'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'MALFORMED_OUTPUT'
  | 'PERSISTENCE'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'NETWORK'
  | 'WORKFLOW'

/** Only these may be retried; validation/auth failures are deterministic and never retried. */
export const TRANSIENT_FAILURES: ReadonlySet<FailureKind> = new Set([
  'PROVIDER', 'TIMEOUT', 'RATE_LIMIT', 'MALFORMED_OUTPUT', 'NETWORK',
])

/** Spec default: at most 2 retries (3 attempts). */
export const DEFAULT_MAX_RETRIES = 2

export class WorkflowError extends Error {
  readonly kind: FailureKind
  constructor(kind: FailureKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WorkflowError'
    this.kind = kind
  }
}

export interface WorkflowFailure {
  readonly node: WorkflowNode
  readonly kind: FailureKind
  readonly message: string
  readonly claimId?: string
}

export interface TraceEntry {
  readonly node: WorkflowNode
  readonly attempt: number
  readonly outcome: 'OK' | 'RETRY' | 'FAILED'
  readonly at: string
  readonly investigationId: string
  readonly detail?: string
}

export interface WorkflowClaim {
  readonly id: string
  readonly ordinal: number
  readonly statement: string
}

/** A candidate is never trusted until validated; provenance fields come from a real retrieval. */
export interface EvidenceCandidate {
  readonly sourceUrl: string
  readonly sourceTitle: string
  readonly excerpt: string
  readonly relationship: EvidenceRelationship
  readonly strength: EvidenceStrength
}

export interface Assessment {
  readonly claimId: string
  readonly proposedState: ClaimState
  readonly confidence: ConfidenceLevel
  readonly rationale: string
  readonly evidenceIds: readonly string[]
}

export interface ClaimOutcome {
  readonly claimId: string
  readonly state: ClaimState
  readonly confidence: ConfidenceLevel
}

export interface WorkflowSnapshot {
  readonly investigationId: string
  readonly ownerId: string
  readonly question: string
  readonly status: WorkflowStatus
  readonly claims: readonly WorkflowClaim[]
  readonly evidenceByClaim: Readonly<Record<string, readonly EvidenceCandidate[]>>
  readonly assessments: Readonly<Record<string, Assessment>>
  readonly outcomes: Readonly<Record<string, ClaimOutcome>>
  readonly summary: string | null
  readonly trace: readonly TraceEntry[]
  readonly failures: readonly WorkflowFailure[]
}

/** A node returns only the state fields it owns; nothing is persisted implicitly. */
export type NodeUpdate = Partial<
  Pick<
    WorkflowSnapshot,
    'claims' | 'evidenceByClaim' | 'assessments' | 'outcomes' | 'summary' | 'status' | 'question'
  >
>

export type NodeHandler = (state: WorkflowSnapshot) => Promise<NodeUpdate>
export type NodeHandlers = Readonly<Record<WorkflowNode, NodeHandler>>

export interface WorkflowOptions {
  readonly maxRetries?: number
  readonly now?: () => Date
  /** Receives each trace entry; must never be given secrets or source bodies. */
  readonly log?: (entry: TraceEntry) => void
}
