import { Link } from 'react-router-dom'
import { StateBadge } from '../components/StateBadge'
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
      <ol className="features" aria-label="How it works">
        <li className="feature">
          <h3>Ask</h3>
          <p>State one question. It is broken into claims that can each be checked on their own.</p>
        </li>
        <li className="feature">
          <h3>Gather</h3>
          <p>Real sources are retrieved. Every excerpt is quoted verbatim and linked to where it came from.</p>
        </li>
        <li className="feature">
          <h3>Weigh</h3>
          <p>Supporting and contradicting evidence are kept side by side. Rules, not the model, decide what is allowed.</p>
        </li>
        <li className="feature">
          <h3>Track</h3>
          <p>When new evidence arrives, a changed state is recorded in an append-only history with its trigger.</p>
        </li>
      </ol>
      <ul className="legend" aria-label="Claim states">
        <li><StateBadge state="SUPPORTED" /> the evidence supports it</li>
        <li><StateBadge state="PARTIALLY_SUPPORTED" /> only in part</li>
        <li><StateBadge state="CONFLICTING" /> sources disagree</li>
        <li><StateBadge state="INSUFFICIENT" /> not enough to say</li>
      </ul>
    </section>
  )
}
