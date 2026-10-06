import type { ApiResult, Claim, Investigation } from '../api/contracts'

/**
 * The frontend's only view of the backend. It speaks the same typed contracts as the server-side
 * operations (frontend/src/api), and the server derives the caller's identity: the browser never
 * passes an owner id or any credential. No live adapter exists until the Momen schema is available.
 */
export interface InvestigationGateway {
  createInvestigation(input: { question: string; idempotencyKey?: string }): Promise<ApiResult<Investigation>>
  getInvestigation(id: string): Promise<ApiResult<Investigation>>
  listClaims(investigationId: string): Promise<ApiResult<Claim[]>>
}
