import type { ApiError, ApiResult } from '../api/contracts'
import type { InvestigationGateway } from './types'

const NETWORK_ERROR: ApiError = { code: 'INTERNAL_ERROR', message: 'EvidenceOS could not reach the server. Check your connection and try again.' }

function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && typeof (value as ApiError).code === 'string' && typeof (value as ApiError).message === 'string'
}

/**
 * Talks to the same-origin EvidenceOS API. The server identifies the caller (HttpOnly cookie) and
 * enforces ownership; this client sends no credentials of its own and never decides claim state.
 */
export function createHttpGateway(baseUrl = '/api', fetchImpl: typeof fetch = (...args) => fetch(...args)): InvestigationGateway {
  async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { credentials: 'same-origin', ...init })
    } catch {
      return { ok: false, error: NETWORK_ERROR }
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The server sent an unreadable response.' } }
    }
    const record = (typeof body === 'object' && body !== null ? body : {}) as { data?: T; error?: unknown }
    if (response.ok && 'data' in record) return { ok: true, data: record.data as T }
    return { ok: false, error: isApiError(record.error) ? record.error : { code: 'INTERNAL_ERROR', message: 'The server returned an unexpected response.' } }
  }

  const post = (payload?: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
  const enc = encodeURIComponent

  return {
    createInvestigation: (input) => call('/investigations', post(input)),
    getDemoInvestigation: () => call('/demo'),
    getInvestigation: (id) => call(`/investigations/${enc(id)}`),
    listClaims: (id) => call(`/investigations/${enc(id)}/claims`),
    listEvidence: (id) => call(`/investigations/${enc(id)}/evidence`),
    listSources: (id) => call(`/investigations/${enc(id)}/sources`),
    listEvidenceChanges: (id) => call(`/investigations/${enc(id)}/changes`),
    refreshEvidence: (id) => call(`/investigations/${enc(id)}/refresh`, post()),
  }
}
