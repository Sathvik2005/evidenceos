import { Link } from 'react-router-dom'
import type { Claim } from '../api/contracts'
import { CONFIDENCE_LABEL } from '../lib/labels'
import { StateBadge } from './StateBadge'

export function ConfidenceNote({ confidence }: { confidence: Claim['confidence'] }) {
  // Confidence answers "how sure are we"; it is shown separately from the state.
  return <span className="confidence">Confidence: {confidence ? CONFIDENCE_LABEL[confidence] : 'not assessed'}</span>
}

export function ClaimCard({ claim, investigationId }: { claim: Claim; investigationId: string }) {
  return (
    <li className="claim">
      <p className="claim__statement">{claim.statement}</p>
      <p className="claim__meta">
        <StateBadge state={claim.state} /> <ConfidenceNote confidence={claim.confidence} />
      </p>
      <Link to={`/investigations/${investigationId}/claims/${claim.id}`}>Inspect evidence</Link>
    </li>
  )
}
