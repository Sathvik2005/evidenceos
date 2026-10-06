// Typed request/response contracts for the EvidenceOS persistence API.
// Enum values mirror database/migrations/001_initial_schema.sql (provisional).

export const CLAIM_STATES = ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONFLICTING', 'INSUFFICIENT'] as const
export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const
export const EVIDENCE_RELATIONSHIPS = ['SUPPORTS', 'CONTRADICTS', 'PARTIALLY_SUPPORTS', 'INSUFFICIENT'] as const
export const EVIDENCE_STRENGTHS = ['STRONG', 'MODERATE', 'WEAK', 'UNKNOWN'] as const
export const SOURCE_TYPES = ['WEB_PAGE', 'JOURNAL_ARTICLE', 'BOOK', 'REPORT', 'DATASET', 'OTHER'] as const

export const INVESTIGATION_STATUSES = ['CREATED', 'RESEARCHING', 'ANALYZING', 'READY', 'REVIEW_REQUIRED', 'ERROR'] as const
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number]
export type ClaimState = (typeof CLAIM_STATES)[number]
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]
export type EvidenceRelationship = (typeof EVIDENCE_RELATIONSHIPS)[number]
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number]
export type SourceType = (typeof SOURCE_TYPES)[number]

export const MAX_PAGE_SIZE = 100
export const DEFAULT_PAGE_SIZE = 25

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

export interface Page {
  readonly limit?: number
  readonly offset?: number
}

export interface CreateInvestigationInput {
  readonly question: string
  readonly idempotencyKey?: string
}
export interface AddClaimInput {
  readonly investigationId: string
  readonly ordinal: number
  readonly statement: string
  readonly idempotencyKey?: string
}
export interface AddSourceInput {
  readonly investigationId: string
  readonly sourceType: SourceType
  readonly url: string
  readonly title: string
  readonly publisher?: string
  readonly publishedAt?: string
  readonly idempotencyKey?: string
}
export interface AddEvidenceInput {
  readonly investigationId: string
  readonly claimId: string
  readonly sourceId: string
  readonly relationship: EvidenceRelationship
  readonly strength: EvidenceStrength
  readonly excerpt: string
  readonly idempotencyKey?: string
}
export interface RecordStateChangeInput {
  readonly investigationId: string
  readonly claimId: string
  readonly previousState: ClaimState | null
  readonly newState: ClaimState
  readonly reason: string
  readonly triggeringEvidenceId: string
  readonly idempotencyKey: string
}

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
  readonly state: ClaimState | null
  readonly confidence: ConfidenceLevel | null
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
}
export interface EvidenceChange {
  readonly id: string
  readonly investigationId: string
  readonly claimId: string
  readonly previousState: ClaimState | null
  readonly newState: ClaimState
  readonly reason: string
  readonly triggeringEvidenceId: string
  readonly changedAt: string
}

// ---- validation -----------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function fail(code: ApiErrorCode, message: string, field?: string): ApiResult<never> {
  return { ok: false, error: field === undefined ? { code, message } : { code, message, field } }
}

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

export function invalid(field: string, message: string): ApiResult<never> {
  return fail('VALIDATION_FAILED', message, field)
}

export function checkText(value: unknown, field: string, max = 4000): ApiResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(field, `${field} must be a non-empty string.`)
  }
  if (value.length > max) return invalid(field, `${field} must be at most ${max} characters.`)
  return ok(value.trim())
}

export function checkOptionalText(value: unknown, field: string, max = 4000): ApiResult<string | undefined> {
  return value === undefined ? ok(undefined) : checkText(value, field, max)
}

export function checkUuid(value: unknown, field: string): ApiResult<string> {
  return typeof value === 'string' && UUID.test(value)
    ? ok(value.toLowerCase())
    : invalid(field, `${field} must be a UUID.`)
}

export function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): ApiResult<T> {
  return allowed.includes(value as T)
    ? ok(value as T)
    : invalid(field, `${field} must be one of: ${allowed.join(', ')}.`)
}

export function checkHttpUrl(value: unknown, field: string): ApiResult<string> {
  const text = checkText(value, field, 2048)
  if (!text.ok) return text
  try {
    const url = new URL(text.data)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
    if (url.username || url.password) throw new Error('credentials')
  } catch {
    return invalid(field, `${field} must be an http(s) URL without credentials.`)
  }
  return text
}

export function checkPage(page: Page): ApiResult<{ limit: number; offset: number }> {
  const limit = page.limit ?? DEFAULT_PAGE_SIZE
  const offset = page.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    return invalid('limit', `limit must be an integer between 1 and ${MAX_PAGE_SIZE}.`)
  }
  if (!Number.isInteger(offset) || offset < 0) return invalid('offset', 'offset must be a non-negative integer.')
  return ok({ limit, offset })
}
