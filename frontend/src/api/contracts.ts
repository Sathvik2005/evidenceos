// Wire contracts of the EvidenceOS HTTP API, as the browser sees them.
//
// The API is implemented by the Python backend (`backend/evidenceos`). This file holds only the types
// and enums the UI needs; every validation and business rule lives on the server, and the browser never
// computes a claim state. `frontend/tests/fixtures/wire.json` pins the record shapes: the backend tests
// assert the API returns exactly these keys and the frontend tests assert the same.

export const CLAIM_STATES = ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONFLICTING', 'INSUFFICIENT'] as const
export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const
export const EVIDENCE_RELATIONSHIPS = ['SUPPORTS', 'CONTRADICTS', 'PARTIALLY_SUPPORTS', 'INSUFFICIENT'] as const
export const EVIDENCE_STRENGTHS = ['STRONG', 'MODERATE', 'WEAK'] as const
export const SOURCE_TYPES = ['WEB_PAGE', 'JOURNAL_ARTICLE', 'BOOK', 'REPORT', 'DATASET', 'OTHER'] as const
export const INVESTIGATION_STATUSES = ['CREATED', 'RESEARCHING', 'ANALYZING', 'READY', 'REVIEW_REQUIRED', 'ERROR'] as const

export type ClaimState = (typeof CLAIM_STATES)[number]
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]
export type EvidenceRelationship = (typeof EVIDENCE_RELATIONSHIPS)[number]
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number]
export type SourceType = (typeof SOURCE_TYPES)[number]
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number]

export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'REFERENCE_INVALID'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CONSTRAINT_VIOLATION'
  | 'INTERNAL_ERROR'

export interface ApiError {
  readonly code: ApiErrorCode
  readonly message: string
  readonly field?: string
}

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ApiError }

export interface Investigation {
  readonly id: string
  readonly question: string
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface Claim {
  readonly id: string
  readonly investigationId: string
  readonly ordinal: number
  readonly statement: string
  /** Null until the claim has been assessed. */
  readonly state: ClaimState | null
  readonly confidence: ConfidenceLevel | null
  readonly assessmentReason: string | null
}

export interface Source {
  readonly id: string
  readonly investigationId: string
  readonly sourceType: SourceType
  readonly url: string
  readonly title: string
  readonly publisher: string | null
  readonly publishedAt: string | null
}

export interface Evidence {
  readonly id: string
  readonly investigationId: string
  readonly claimId: string
  readonly sourceId: string
  readonly relationship: EvidenceRelationship
  readonly strength: EvidenceStrength
  readonly excerpt: string
  readonly reasoning: string | null
}

export interface EvidenceChange {
  readonly id: string
  readonly investigationId: string
  readonly claimId: string
  readonly previousState: ClaimState
  readonly newState: ClaimState
  readonly reason: string
  readonly triggeringEvidenceId: string
  readonly changedAt: string
}
