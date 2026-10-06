// Test gateway: the real server-side operations over a migrated in-memory PostgreSQL, scoped to one
// owner. Nothing here invents data; it only connects the UI to persisted state.
import type { ApiResult, Investigation } from '../../src/api/contracts'
import type { InvestigationGateway } from '../../src/gateway/types'
import {
  createInvestigation, getInvestigation, listClaims, listEvidence, listEvidenceChanges, listSources, type Database,
} from '../../src/api/operations'

export function directGateway(
  db: Database,
  ownerId: string,
  startWorkflow: (investigationId: string) => Promise<unknown>,
): InvestigationGateway & { readonly runs: string[] } {
  const runs: string[] = []
  const start = (id: string) => {
    runs.push(id)
    void startWorkflow(id) // fire and forget: the UI observes real persisted progress
  }
  return {
    runs,
    async createInvestigation(input): Promise<ApiResult<Investigation>> {
      const result = await createInvestigation(db, ownerId, input)
      if (result.ok) start(result.data.id)
      return result
    },
    getInvestigation: (id) => getInvestigation(db, ownerId, id),
    listClaims: (id) => listClaims(db, ownerId, id, { limit: 100 }),
    listEvidence: (id) => listEvidence(db, ownerId, id, { limit: 100 }),
    listSources: (id) => listSources(db, ownerId, id, { limit: 100 }),
    listEvidenceChanges: (id) => listEvidenceChanges(db, ownerId, id, { limit: 100 }),
    async refreshEvidence(id) {
      const current = await getInvestigation(db, ownerId, id)
      if (current.ok) start(id)
      return current
    },
  }
}
