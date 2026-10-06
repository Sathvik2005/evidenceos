import type { ApiResult, Claim, Evidence, EvidenceChange, Investigation, Source } from '../api/contracts'

/**
 * The frontend's only view of the backend. It speaks the same typed contracts as the server-side
 * operations (frontend/src/api), and the server derives the caller's identity: the browser never
 * passes an owner id or any credential. Claim state is never computed on the client.
 */
export interface InvestigationGateway {
  /** Creates the investigation and starts the research workflow on the server. */
  createInvestigation(input: { question: string; idempotencyKey?: string }): Promise<ApiResult<Investigation>>
  getInvestigation(id: string): Promise<ApiResult<Investigation>>
  listClaims(investigationId: string): Promise<ApiResult<Claim[]>>
  listEvidence(investigationId: string): Promise<ApiResult<Evidence[]>>
  listSources(investigationId: string): Promise<ApiResult<Source[]>>
  listEvidenceChanges(investigationId: string): Promise<ApiResult<EvidenceChange[]>>
  /** Starts another research run so newly available evidence can be assessed (or a failed run retried). */
  refreshEvidence(investigationId: string): Promise<ApiResult<Investigation>>
}
