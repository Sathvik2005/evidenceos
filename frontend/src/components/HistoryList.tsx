import type { Claim, Evidence, EvidenceChange } from '../api/contracts'
import { formatDate } from '../lib/labels'
import { StateBadge } from './StateBadge'

/** State history is append-only on the backend; this view only displays it, newest first. */
export function HistoryList({ changes, evidence, claims }: { changes: readonly EvidenceChange[]; evidence: readonly Evidence[]; claims?: readonly Claim[] }) {
  if (changes.length === 0) return <p className="muted">No state changes yet. A change is recorded only when new evidence alters a claim's state.</p>
  const ordered = [...changes].sort((a, b) => b.changedAt.localeCompare(a.changedAt))
  return (
    <ol className="history">
      {ordered.map((change) => {
        const trigger = evidence.find((e) => e.id === change.triggeringEvidenceId)
        const claim = claims?.find((c) => c.id === change.claimId)
        return (
          <li key={change.id} className="history__item">
            {claim ? <p className="history__claim">{claim.statement}</p> : null}
            <p>
              <StateBadge state={change.previousState} /> <span aria-label="changed to">→</span> <StateBadge state={change.newState} />
              <span className="muted"> · {formatDate(change.changedAt)}</span>
            </p>
            <p>{change.reason}</p>
            {trigger ? <p className="muted">Triggered by new evidence: “{trigger.excerpt}”</p> : null}
          </li>
        )
      })}
    </ol>
  )
}
