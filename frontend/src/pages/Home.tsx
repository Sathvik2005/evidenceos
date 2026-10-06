import { Link } from 'react-router-dom'
import { useGateway } from '../gateway/gatewayContext'
import { useResource } from '../hooks/useResource'

export function Home() {
  const gateway = useGateway()
  // The demo link appears only when the server really has a demo investigation.
  const { resource } = useResource(async () =>
    gateway ? gateway.getDemoInvestigation() : { ok: true as const, data: { investigationId: null } })
  const demoId = resource.status === 'ready' ? resource.data.investigationId : null

  return (
    <section className="hero">
      <p className="eyebrow">Evidence operating system</p>
      <h1>Build evidence. Track change. Understand what holds up.</h1>
      <p className="lede">
        EvidenceOS does not tell you what to believe. It shows what the available evidence currently
        supports, where it conflicts, what remains uncertain, and what changed when new evidence arrived.
      </p>
      <p className="actions">
        <Link className="button button--primary" to="/investigations/new">Begin an investigation</Link>
        {demoId ? <Link className="button button--quiet" to={`/investigations/${demoId}`}>View the demo investigation</Link> : null}
      </p>
    </section>
  )
}
