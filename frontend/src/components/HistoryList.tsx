import { Link } from 'react-router-dom'
import type { Claim, Evidence, EvidenceChange, Source } from '../api/contracts'
import { formatDate } from '../lib/labels'
import { EvidenceCard } from './EvidenceCard'
import { StateBadge } from './StateBadge'

interface HistoryListProps {
  changes: readonly EvidenceChange[]
  evidence: readonly Evidence[]
  investigationId: string
  claims?: readonly Claim[]
  sources?: readonly Source[]
}

/** State history is append-only on the backend; this view only displays it, newest first. */
export function HistoryList({ changes, evidence, investigationId, claims, sources }: HistoryListProps) {
  if (changes.length === 0) return <p className="muted">No state changes yet. A change is recorded only when new evidence alters a claim's state.</p>
  const ordered = [...changes].sort((a, b) => b.changedAt.localeCompare(a.changedAt))
  return (
    <>
      <p className="muted">{ordered.length} recorded {ordered.length === 1 ? 'change' : 'changes'}, newest first. Each one names the evidence that caused it.</p>
      <ol className="history">
        {ordered.map((change) => {
          const trigger = evidence.find((e) => e.id === change.triggeringEvidenceId)
          const source = trigger ? sources?.find((s) => s.id === trigger.sourceId) : undefined
          const claim = claims?.find((c) => c.id === change.claimId)
          return (
            <li key={change.id} className="history__item">
              {claim ? (
                <p className="history__claim">
                  <Link to={`/investigations/${investigationId}/claims/${claim.id}`}>{claim.statement}</Link>
                </p>
              ) : null}
              <p className="history__transition">
                <StateBadge state={change.previousState} /> <span aria-label="changed to">→</span> <StateBadge state={change.newState} />
                <span className="muted"> · {formatDate(change.changedAt)}</span>
              </p>
              <p>{change.reason}</p>
              {trigger ? (
                <div className="history__trigger">
                  <p className="history__trigger-label">The new evidence that triggered this change</p>
                  <EvidenceCard evidence={trigger} source={source} />
                </div>
              ) : (
                <p className="muted">The triggering evidence record is unavailable.</p>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}
