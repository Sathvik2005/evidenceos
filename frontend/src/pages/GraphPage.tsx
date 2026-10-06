import { Link, useParams } from 'react-router-dom'
import { EvidenceGraphView } from '../components/EvidenceGraphView'
import { ErrorState, LoadingState } from '../components/StatusViews'
import { useGateway } from '../gateway/gatewayContext'
import { buildEvidenceGraph } from '../graph/buildGraph'
import { useResource } from '../hooks/useResource'

export function GraphPage() {
  const gateway = useGateway()
  const { id = '' } = useParams()
  const { resource, reload } = useResource(async () => {
    if (!gateway) return { ok: false as const, error: { code: 'INTERNAL_ERROR' as const, message: 'EvidenceOS has no backend configured.' } }
    const [claims, evidence, sources] = await Promise.all([gateway.listClaims(id), gateway.listEvidence(id), gateway.listSources(id)])
    if (!claims.ok) return claims
    if (!evidence.ok) return evidence
    if (!sources.ok) return sources
    return { ok: true as const, data: buildEvidenceGraph(claims.data, evidence.data, sources.data) }
  })

  return (
    <article>
      <p><Link to={`/investigations/${id}`}>← Investigation</Link></p>
      <h1>Evidence graph</h1>
      {resource.status === 'loading' ? <LoadingState label="Loading graph" /> : null}
      {resource.status === 'error' ? <ErrorState title="Graph unavailable" message={resource.error.message} onRetry={reload} /> : null}
      {resource.status === 'ready' ? <EvidenceGraphView graph={resource.data} /> : null}
    </article>
  )
}
