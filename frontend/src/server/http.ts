// Framework-agnostic HTTP API over the typed operations. Server-side only. It maps standard
// Request/Response so it runs unchanged in a Vercel Function, a Node server, or a test.
import type { ApiError, ApiErrorCode, ApiResult } from '../api/contracts'
import {
  claimInvestigationRun, createInvestigation, getInvestigation, listClaims, listEvidence,
  listEvidenceChanges, listSources, type Database,
} from '../api/operations'

export interface ApiDeps {
  readonly db: Database
  /** Starts the research workflow without blocking the response (e.g. waitUntil). */
  readonly startWorkflow: (investigationId: string, ownerId: string) => void
  /** When set, this investigation (owned by demoOwnerId) is readable, never writable, by everyone. */
  readonly demo?: { readonly investigationId: string; readonly ownerId: string }
  readonly secureCookies?: boolean
  /** False when model or retrieval credentials are missing: runs are refused up front, honestly. */
  readonly researchAvailable?: boolean
  readonly log?: (entry: Record<string, unknown>) => void
}

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  REFERENCE_INVALID: 422,
  CONSTRAINT_VIOLATION: 422,
  INTERNAL_ERROR: 500,
}

const COOKIE = 'eos_uid'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 16 * 1024
/** A run with no status progress for this long is treated as abandoned and may be resumed. */
export const STALE_RUN_MINUTES = 10
const BASE_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } })
}

function apiError(error: ApiError, extra: Record<string, string> = {}): Response {
  // Internal details never reach the client: only the code, message and offending field.
  return json(STATUS_BY_CODE[error.code], { error }, extra)
}

function fail(code: ApiErrorCode, message: string, field?: string): ApiResult<never> {
  return { ok: false, error: field === undefined ? { code, message } : { code, message, field } }
}

function readCookie(request: Request): string | null {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE) {
      const value = rest.join('=')
      return UUID.test(value) ? value.toLowerCase() : null
    }
  }
  return null
}

async function readJson(request: Request): Promise<ApiResult<Record<string, unknown>>> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return fail('VALIDATION_FAILED', 'Content-Type must be application/json.')
  }
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return fail('VALIDATION_FAILED', 'The request body is too large.')
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return { ok: true, data: parsed as Record<string, unknown> }
  } catch {
    // fall through
  }
  return fail('VALIDATION_FAILED', 'The request body must be a JSON object.')
}

/** Blocks cross-site writes: cookies identify the caller, so a foreign Origin must not mutate. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

function pageOf(url: URL) {
  const limit = url.searchParams.get('limit')
  const offset = url.searchParams.get('offset')
  return {
    ...(limit === null ? { limit: 100 } : { limit: Number(limit) }),
    ...(offset === null ? {} : { offset: Number(offset) }),
  }
}

export async function handleApiRequest(request: Request, deps: ApiDeps): Promise<Response> {
  const started = Date.now()
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/'
  const segments = path.split('/').filter(Boolean)

  // Identity: an anonymous, HttpOnly per-browser id. It scopes every record; it grants nothing else.
  const existing = readCookie(request)
  const ownerId = existing ?? crypto.randomUUID()
  const cookie: Record<string, string> = existing
    ? {}
    : { 'set-cookie': `${COOKIE}=${ownerId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${deps.secureCookies ? '; Secure' : ''}` }

  const respond = (response: Response): Response => {
    deps.log?.({ evt: 'api', method: request.method, path, status: response.status, ms: Date.now() - started })
    return response
  }

  try {
    if (path === '/health') {
      if (request.method !== 'GET') return respond(json(405, { error: { code: 'VALIDATION_FAILED', message: 'Method not allowed.' } }))
      try {
        await deps.db.query('SELECT 1 AS ok')
        return respond(json(200, { status: 'ok' }))
      } catch {
        return respond(json(503, { status: 'unavailable' }))
      }
    }

    if (path === '/demo') {
      if (request.method !== 'GET') return respond(json(405, { error: { code: 'VALIDATION_FAILED', message: 'Method not allowed.' } }, cookie))
      return respond(json(200, { data: { investigationId: deps.demo?.investigationId ?? null } }, cookie))
    }

    if (segments[0] !== 'investigations') return respond(json(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } }, cookie))
    const isWrite = request.method === 'POST'
    if (request.method !== 'GET' && !isWrite) return respond(json(405, { error: { code: 'VALIDATION_FAILED', message: 'Method not allowed.' } }, cookie))
    if (isWrite && !sameOrigin(request)) return respond(json(403, { error: { code: 'VALIDATION_FAILED', message: 'Cross-origin writes are not allowed.' } }, cookie))

    // POST /investigations
    if (segments.length === 1) {
      if (!isWrite) return respond(json(405, { error: { code: 'VALIDATION_FAILED', message: 'Method not allowed.' } }, cookie))
      if (deps.researchAvailable === false) return respond(json(503, { error: { code: 'INTERNAL_ERROR', message: 'Research is not configured on this server, so new investigations cannot run.' } }, cookie))
      const body = await readJson(request)
      if (!body.ok) return respond(apiError(body.error, cookie))
      const result = await createInvestigation(deps.db, ownerId, {
        question: body.data.question as string,
        ...(typeof body.data.idempotencyKey === 'string' ? { idempotencyKey: body.data.idempotencyKey } : {}),
      })
      if (!result.ok) return respond(apiError(result.error, cookie))
      // A replay of an already-started request must not start a second run.
      if (result.data.status === 'CREATED') {
        const claimed = await claimInvestigationRun(deps.db, ownerId, result.data.id, ['CREATED'])
        if (claimed.ok) deps.startWorkflow(result.data.id, ownerId)
      }
      return respond(json(201, { data: result.data }, cookie))
    }

    const id = segments[1] ?? ''
    const resource = segments[2]
    if (segments.length > 3) return respond(json(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } }, cookie))

    if (resource === 'refresh') {
      if (!isWrite) return respond(json(405, { error: { code: 'VALIDATION_FAILED', message: 'Method not allowed.' } }, cookie))
      if (deps.researchAvailable === false) return respond(json(503, { error: { code: 'INTERNAL_ERROR', message: 'Research is not configured on this server.' } }, cookie))
      // Atomic: only one run can be claimed; a busy investigation is refused, not double-started.
      const claimed = await claimInvestigationRun(deps.db, ownerId, id, ['READY', 'REVIEW_REQUIRED', 'ERROR'], STALE_RUN_MINUTES)
      if (!claimed.ok) return respond(apiError(claimed.error, cookie))
      deps.startWorkflow(id, ownerId)
      return respond(json(202, { data: claimed.data }, cookie))
    }
    if (isWrite) return respond(json(405, { error: { code: 'VALIDATION_FAILED', message: 'Method not allowed.' } }, cookie))

    const page = pageOf(url)
    const read = async (owner: string): Promise<ApiResult<unknown>> => {
      switch (resource) {
        case undefined: return getInvestigation(deps.db, owner, id)
        case 'claims': return listClaims(deps.db, owner, id, page)
        case 'evidence': return listEvidence(deps.db, owner, id, page)
        case 'sources': return listSources(deps.db, owner, id, page)
        case 'changes': return listEvidenceChanges(deps.db, owner, id, page)
        default: return fail('NOT_FOUND', 'Not found.')
      }
    }
    let result = await read(ownerId)
    if (!result.ok && result.error.code === 'NOT_FOUND' && deps.demo && id.toLowerCase() === deps.demo.investigationId.toLowerCase()) {
      result = await read(deps.demo.ownerId) // the public demo is read-only for everyone
    }
    return respond(result.ok ? json(200, { data: result.data }, cookie) : apiError(result.error, cookie))
  } catch {
    return respond(json(500, { error: { code: 'INTERNAL_ERROR', message: 'The operation could not be completed.' } }, cookie))
  }
}
