// Server-side persistence operations. Never import this from browser code:
// callers are trusted to supply the authenticated `ownerId`.
import {
  checkEnum, checkHttpUrl, checkOptionalText, checkPage, checkText, checkUuid, fail, ok,
  CLAIM_STATES, CONFIDENCE_LEVELS, EVIDENCE_RELATIONSHIPS, EVIDENCE_STRENGTHS, INVESTIGATION_STATUSES, SOURCE_TYPES,
  type AddClaimInput, type AddEvidenceInput, type AddSourceInput, type ApiResult, type Claim,
  type CreateInvestigationInput, type Evidence, type EvidenceChange, type Investigation, type Page,
  type RecordStateChangeInput, type Source,
} from './contracts'

export interface Database {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

type Row = Record<string, unknown>

const iso = (value: unknown): string => new Date(value as string | Date).toISOString()
const isoOrNull = (value: unknown): string | null => (value == null ? null : iso(value))

const toInvestigation = (r: Row): Investigation => ({
  id: r.id as string, question: r.question as string, status: r.status as string,
  createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
})
const toClaim = (r: Row): Claim => ({
  id: r.id as string, investigationId: r.investigation_id as string, ordinal: r.ordinal as number,
  statement: r.statement as string, state: r.state as Claim['state'], confidence: r.confidence as Claim['confidence'],
  assessmentReason: (r.assessment_reason as string | null) ?? null,
})
const toSource = (r: Row): Source => ({
  id: r.id as string, investigationId: r.investigation_id as string, sourceType: r.source_type as Source['sourceType'],
  url: r.url as string, title: r.title as string, publisher: (r.publisher as string | null) ?? null,
  publishedAt: isoOrNull(r.published_at),
})
const toEvidence = (r: Row): Evidence => ({
  id: r.id as string, investigationId: r.investigation_id as string, claimId: r.claim_id as string,
  sourceId: r.source_id as string, relationship: r.relationship as Evidence['relationship'],
  strength: r.strength as Evidence['strength'], excerpt: r.excerpt as string,
  reasoning: (r.reasoning as string | null) ?? null,
})
const toChange = (r: Row): EvidenceChange => ({
  id: r.id as string, investigationId: r.investigation_id as string, claimId: r.claim_id as string,
  previousState: r.previous_state as EvidenceChange['previousState'], newState: r.new_state as EvidenceChange['newState'],
  reason: r.reason as string, triggeringEvidenceId: r.triggering_evidence_id as string, changedAt: iso(r.changed_at),
})

/** Maps database failures to structured errors without leaking SQL or internals. */
function mapDatabaseError(error: unknown): ApiResult<never> {
  const code = (error as { code?: string } | null)?.code
  switch (code) {
    case '23503': return fail('REFERENCE_INVALID', 'A referenced record does not exist or belongs to a different investigation/claim.')
    case '23505': return fail('CONFLICT', 'A record with the same unique value already exists.')
    case '23514': return fail('CONSTRAINT_VIOLATION', 'The request violates a data integrity rule.')
    case '22P02': return fail('VALIDATION_FAILED', 'A value has an invalid format.')
    default: return fail('INTERNAL_ERROR', 'The operation could not be completed.')
  }
}

function firstError(...results: ApiResult<unknown>[]): ApiResult<never> | null {
  for (const result of results) if (!result.ok) return result
  return null
}

const UNREACHABLE = fail('INTERNAL_ERROR', 'Unreachable.')

async function assertOwned(db: Database, ownerId: string, investigationId: string): Promise<ApiResult<null>> {
  const owner = checkText(ownerId, 'ownerId', 200)
  if (!owner.ok) return owner
  try {
    const { rows } = await db.query<Row>('SELECT 1 FROM investigations WHERE id = $1 AND owner_id = $2', [investigationId, owner.data])
    // Same response for missing and foreign investigations so existence is not leaked.
    return rows.length > 0 ? ok(null) : fail('NOT_FOUND', 'Investigation not found.')
  } catch (error) {
    return mapDatabaseError(error)
  }
}

/**
 * Idempotent insert: with a key, an identical replay returns the stored record,
 * a replay with different content is rejected, and nothing is duplicated.
 */
async function insertOnce<T>(opts: {
  idempotencyKey: string | undefined
  lookup: (key: string) => Promise<T | null>
  matches: (existing: T) => boolean
  insert: () => Promise<T>
}): Promise<ApiResult<T>> {
  try {
    const key = opts.idempotencyKey
    if (key !== undefined) {
      const existing = await opts.lookup(key)
      if (existing !== null) {
        return opts.matches(existing)
          ? ok(existing)
          : fail('IDEMPOTENCY_CONFLICT', 'The idempotency key was already used with different content.', 'idempotencyKey')
      }
    }
    return ok(await opts.insert())
  } catch (error) {
    return mapDatabaseError(error)
  }
}

const optionalKey = (value: unknown) => checkOptionalText(value, 'idempotencyKey', 200)

export async function createInvestigation(db: Database, ownerId: string, input: CreateInvestigationInput): Promise<ApiResult<Investigation>> {
  const owner = checkText(ownerId, 'ownerId', 200)
  const question = checkText(input.question, 'question', 2000)
  const key = optionalKey(input.idempotencyKey)
  const bad = firstError(owner, question, key)
  if (bad || !owner.ok || !question.ok || !key.ok) return bad ?? UNREACHABLE
  return insertOnce<Investigation>({
    idempotencyKey: key.data,
    lookup: async (k) => {
      const { rows } = await db.query<Row>('SELECT * FROM investigations WHERE owner_id = $1 AND idempotency_key = $2', [owner.data, k])
      return rows[0] ? toInvestigation(rows[0]) : null
    },
    matches: (e) => e.question === question.data,
    insert: async () => {
      const { rows } = await db.query<Row>(
        'INSERT INTO investigations (owner_id, question, idempotency_key) VALUES ($1, $2, $3) RETURNING *',
        [owner.data, question.data, key.data ?? null])
      return toInvestigation(rows[0] as Row)
    },
  })
}

export async function getInvestigation(db: Database, ownerId: string, investigationId: string): Promise<ApiResult<Investigation>> {
  const id = checkUuid(investigationId, 'investigationId')
  const owner = checkText(ownerId, 'ownerId', 200)
  const bad = firstError(id, owner)
  if (bad || !id.ok || !owner.ok) return bad ?? UNREACHABLE
  try {
    const { rows } = await db.query<Row>('SELECT * FROM investigations WHERE id = $1 AND owner_id = $2', [id.data, owner.data])
    return rows[0] ? ok(toInvestigation(rows[0])) : fail('NOT_FOUND', 'Investigation not found.')
  } catch (error) { return mapDatabaseError(error) }
}

export async function listInvestigations(db: Database, ownerId: string, page: Page = {}): Promise<ApiResult<Investigation[]>> {
  const owner = checkText(ownerId, 'ownerId', 200)
  const p = checkPage(page)
  const bad = firstError(owner, p)
  if (bad || !owner.ok || !p.ok) return bad ?? UNREACHABLE
  try {
    const { rows } = await db.query<Row>(
      'SELECT * FROM investigations WHERE owner_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3',
      [owner.data, p.data.limit, p.data.offset])
    return ok(rows.map(toInvestigation))
  } catch (error) { return mapDatabaseError(error) }
}

export async function addClaim(db: Database, ownerId: string, input: AddClaimInput): Promise<ApiResult<Claim>> {
  const investigationId = checkUuid(input.investigationId, 'investigationId')
  const statement = checkText(input.statement, 'statement', 2000)
  const key = optionalKey(input.idempotencyKey)
  const ordinalOk = Number.isInteger(input.ordinal) && input.ordinal > 0
  const bad = firstError(investigationId, statement, key) ??
    (ordinalOk ? null : fail('VALIDATION_FAILED', 'ordinal must be a positive integer.', 'ordinal'))
  if (bad || !investigationId.ok || !statement.ok || !key.ok) return bad ?? UNREACHABLE
  const owned = await assertOwned(db, ownerId, investigationId.data)
  if (!owned.ok) return owned
  return insertOnce<Claim>({
    idempotencyKey: key.data,
    lookup: async (k) => {
      const { rows } = await db.query<Row>('SELECT * FROM claims WHERE investigation_id = $1 AND idempotency_key = $2', [investigationId.data, k])
      return rows[0] ? toClaim(rows[0]) : null
    },
    matches: (e) => e.statement === statement.data && e.ordinal === input.ordinal,
    insert: async () => {
      const { rows } = await db.query<Row>(
        'INSERT INTO claims (investigation_id, ordinal, statement, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING *',
        [investigationId.data, input.ordinal, statement.data, key.data ?? null])
      return toClaim(rows[0] as Row)
    },
  })
}

export async function addSource(db: Database, ownerId: string, input: AddSourceInput): Promise<ApiResult<Source>> {
  const investigationId = checkUuid(input.investigationId, 'investigationId')
  const sourceType = checkEnum(input.sourceType, SOURCE_TYPES, 'sourceType')
  const url = checkHttpUrl(input.url, 'url')
  const title = checkText(input.title, 'title', 1000)
  const publisher = checkOptionalText(input.publisher, 'publisher', 500)
  const publishedAt = checkOptionalText(input.publishedAt, 'publishedAt', 64)
  const key = optionalKey(input.idempotencyKey)
  const bad = firstError(investigationId, sourceType, url, title, publisher, publishedAt, key) ??
    (publishedAt.ok && publishedAt.data !== undefined && Number.isNaN(Date.parse(publishedAt.data))
      ? fail('VALIDATION_FAILED', 'publishedAt must be an ISO date-time.', 'publishedAt') : null)
  if (bad || !investigationId.ok || !sourceType.ok || !url.ok || !title.ok || !publisher.ok || !publishedAt.ok || !key.ok) {
    return bad ?? UNREACHABLE
  }
  const owned = await assertOwned(db, ownerId, investigationId.data)
  if (!owned.ok) return owned
  return insertOnce<Source>({
    idempotencyKey: key.data,
    lookup: async (k) => {
      const { rows } = await db.query<Row>('SELECT * FROM sources WHERE investigation_id = $1 AND idempotency_key = $2', [investigationId.data, k])
      return rows[0] ? toSource(rows[0]) : null
    },
    matches: (e) => e.url === url.data && e.title === title.data && e.sourceType === sourceType.data,
    insert: async () => {
      const { rows } = await db.query<Row>(
        `INSERT INTO sources (investigation_id, source_type, url, title, publisher, published_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [investigationId.data, sourceType.data, url.data, title.data, publisher.data ?? null, publishedAt.data ?? null, key.data ?? null])
      return toSource(rows[0] as Row)
    },
  })
}

export async function addEvidence(db: Database, ownerId: string, input: AddEvidenceInput): Promise<ApiResult<Evidence>> {
  const investigationId = checkUuid(input.investigationId, 'investigationId')
  const claimId = checkUuid(input.claimId, 'claimId')
  const sourceId = checkUuid(input.sourceId, 'sourceId')
  const relationship = checkEnum(input.relationship, EVIDENCE_RELATIONSHIPS, 'relationship')
  const strength = checkEnum(input.strength, EVIDENCE_STRENGTHS, 'strength')
  const excerpt = checkText(input.excerpt, 'excerpt', 8000)
  const reasoning = checkOptionalText(input.reasoning, 'reasoning', 2000)
  const key = optionalKey(input.idempotencyKey)
  const bad = firstError(investigationId, claimId, sourceId, relationship, strength, excerpt, reasoning, key)
  if (bad || !investigationId.ok || !claimId.ok || !sourceId.ok || !relationship.ok || !strength.ok || !excerpt.ok || !reasoning.ok || !key.ok) {
    return bad ?? UNREACHABLE
  }
  const owned = await assertOwned(db, ownerId, investigationId.data)
  if (!owned.ok) return owned
  return insertOnce<Evidence>({
    idempotencyKey: key.data,
    lookup: async (k) => {
      const { rows } = await db.query<Row>('SELECT * FROM evidence WHERE investigation_id = $1 AND idempotency_key = $2', [investigationId.data, k])
      return rows[0] ? toEvidence(rows[0]) : null
    },
    matches: (e) => e.claimId === claimId.data && e.sourceId === sourceId.data && e.relationship === relationship.data &&
      e.strength === strength.data && e.excerpt === excerpt.data,
    insert: async () => {
      const { rows } = await db.query<Row>(
        `INSERT INTO evidence (investigation_id, claim_id, source_id, relationship, strength, excerpt, reasoning, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [investigationId.data, claimId.data, sourceId.data, relationship.data, strength.data, excerpt.data, reasoning.data ?? null, key.data ?? null])
      return toEvidence(rows[0] as Row)
    },
  })
}

/** Appends an immutable state-change record; the database trigger updates the claim atomically. */
export async function recordStateChange(db: Database, ownerId: string, input: RecordStateChangeInput): Promise<ApiResult<EvidenceChange>> {
  const investigationId = checkUuid(input.investigationId, 'investigationId')
  const claimId = checkUuid(input.claimId, 'claimId')
  const evidenceId = checkUuid(input.triggeringEvidenceId, 'triggeringEvidenceId')
  const newState = checkEnum(input.newState, CLAIM_STATES, 'newState')
  const previousState = checkEnum(input.previousState, CLAIM_STATES, 'previousState')
  const reason = checkText(input.reason, 'reason', 4000)
  const key = checkText(input.idempotencyKey, 'idempotencyKey', 200)
  const bad = firstError(investigationId, claimId, evidenceId, newState, previousState, reason, key) ??
    (input.previousState === input.newState ? fail('VALIDATION_FAILED', 'newState must differ from previousState.', 'newState') : null)
  if (bad || !investigationId.ok || !claimId.ok || !evidenceId.ok || !newState.ok || !previousState.ok || !reason.ok || !key.ok) {
    return bad ?? UNREACHABLE
  }
  const owned = await assertOwned(db, ownerId, investigationId.data)
  if (!owned.ok) return owned
  return insertOnce<EvidenceChange>({
    idempotencyKey: key.data,
    lookup: async (k) => {
      const { rows } = await db.query<Row>('SELECT * FROM evidence_changes WHERE investigation_id = $1 AND idempotency_key = $2', [investigationId.data, k])
      return rows[0] ? toChange(rows[0]) : null
    },
    matches: (e) => e.claimId === claimId.data && e.newState === newState.data && e.previousState === previousState.data &&
      e.triggeringEvidenceId === evidenceId.data,
    insert: async () => {
      const { rows } = await db.query<Row>(
        `INSERT INTO evidence_changes (investigation_id, claim_id, previous_state, new_state, reason, triggering_evidence_id, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [investigationId.data, claimId.data, previousState.data, newState.data, reason.data, evidenceId.data, key.data])
      return toChange(rows[0] as Row)
    },
  })
}

async function listOwned<T>(
  db: Database, ownerId: string, investigationId: string, page: Page, table: string, order: string, map: (r: Row) => T,
): Promise<ApiResult<T[]>> {
  const id = checkUuid(investigationId, 'investigationId')
  const p = checkPage(page)
  const bad = firstError(id, p)
  if (bad || !id.ok || !p.ok) return bad ?? UNREACHABLE
  const owned = await assertOwned(db, ownerId, id.data)
  if (!owned.ok) return owned
  try {
    // `table` and `order` are internal constants, never request input.
    const { rows } = await db.query<Row>(
      `SELECT * FROM ${table} WHERE investigation_id = $1 ORDER BY ${order} LIMIT $2 OFFSET $3`,
      [id.data, p.data.limit, p.data.offset])
    return ok(rows.map(map))
  } catch (error) { return mapDatabaseError(error) }
}

export const listClaims = (db: Database, ownerId: string, investigationId: string, page: Page = {}) =>
  listOwned(db, ownerId, investigationId, page, 'claims', 'ordinal', toClaim)
export const listSources = (db: Database, ownerId: string, investigationId: string, page: Page = {}) =>
  listOwned(db, ownerId, investigationId, page, 'sources', 'created_at, id', toSource)
export const listEvidence = (db: Database, ownerId: string, investigationId: string, page: Page = {}) =>
  listOwned(db, ownerId, investigationId, page, 'evidence', 'created_at, id', toEvidence)
export const listEvidenceChanges = (db: Database, ownerId: string, investigationId: string, page: Page = {}) =>
  listOwned(db, ownerId, investigationId, page, 'evidence_changes', 'changed_at, id', toChange)

export async function setInvestigationStatus(
  db: Database, ownerId: string, investigationId: string, status: string,
): Promise<ApiResult<Investigation>> {
  const id = checkUuid(investigationId, 'investigationId')
  const next = checkEnum(status, INVESTIGATION_STATUSES, 'status')
  const bad = firstError(id, next)
  if (bad || !id.ok || !next.ok) return bad ?? UNREACHABLE
  const owned = await assertOwned(db, ownerId, id.data)
  if (!owned.ok) return owned
  try {
    const { rows } = await db.query<Row>('UPDATE investigations SET status = $2 WHERE id = $1 RETURNING *', [id.data, next.data])
    return rows[0] ? ok(toInvestigation(rows[0])) : fail('NOT_FOUND', 'Investigation not found.')
  } catch (error) { return mapDatabaseError(error) }
}

/** Stores the assessed confidence and reason, and the claim's FIRST state. Later state changes go through recordStateChange. */
export async function recordClaimAssessment(
  db: Database, ownerId: string,
  input: { investigationId: string; claimId: string; confidence: string; reason: string; initialState?: string },
): Promise<ApiResult<Claim>> {
  const investigationId = checkUuid(input.investigationId, 'investigationId')
  const claimId = checkUuid(input.claimId, 'claimId')
  const confidence = checkEnum(input.confidence, CONFIDENCE_LEVELS, 'confidence')
  const reason = checkText(input.reason, 'reason', 4000)
  const initialState = input.initialState === undefined ? ok(undefined) : checkEnum(input.initialState, CLAIM_STATES, 'initialState')
  const bad = firstError(investigationId, claimId, confidence, reason, initialState)
  if (bad || !investigationId.ok || !claimId.ok || !confidence.ok || !reason.ok || !initialState.ok) return bad ?? UNREACHABLE
  const owned = await assertOwned(db, ownerId, investigationId.data)
  if (!owned.ok) return owned
  try {
    const { rows } = await db.query<Row>(
      // The first state may be set here; once set, only evidence_changes can alter it (DB-enforced).
      'UPDATE claims SET confidence = $3, assessment_reason = $4, state = COALESCE(state, $5::claim_state) WHERE investigation_id = $1 AND id = $2 RETURNING *',
      [investigationId.data, claimId.data, confidence.data, reason.data, initialState.data ?? null])
    return rows[0] ? ok(toClaim(rows[0])) : fail('NOT_FOUND', 'Claim not found.')
  } catch (error) { return mapDatabaseError(error) }
}

/**
 * Atomically moves an investigation into RESEARCHING, but only from one of the allowed statuses.
 * This is the single gate that prevents two workflow runs from starting for the same investigation.
 */
export async function claimInvestigationRun(
  db: Database, ownerId: string, investigationId: string, allowedFrom: readonly string[], staleAfterMinutes?: number,
): Promise<ApiResult<Investigation>> {
  const id = checkUuid(investigationId, 'investigationId')
  if (!id.ok) return id
  const owned = await assertOwned(db, ownerId, id.data)
  if (!owned.ok) return owned
  try {
    const { rows } = await db.query<Row>(
      // A run that made no progress for `staleAfterMinutes` (e.g. the function was cut off) may be taken over.
      `UPDATE investigations SET status = 'RESEARCHING'
       WHERE id = $1 AND (status::text = ANY($2::text[])
         OR ($3::int IS NOT NULL AND status::text IN ('CREATED', 'RESEARCHING', 'ANALYZING')
             AND updated_at < now() - make_interval(mins => $3::int)))
       RETURNING *`,
      [id.data, allowedFrom, staleAfterMinutes ?? null])
    return rows[0] ? ok(toInvestigation(rows[0])) : fail('CONFLICT', 'A run is already in progress for this investigation.')
  } catch (error) { return mapDatabaseError(error) }
}
