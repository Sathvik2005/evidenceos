import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { InvestigationStatus } from '../api/contracts'
import { Button } from '../components/Button'
import { ClaimCard } from '../components/ClaimCard'
import { HistoryList } from '../components/HistoryList'
import { ProgressSteps } from '../components/ProgressSteps'
import { EmptyState, ErrorState, LoadingState, PartialNotice } from '../components/StatusViews'
import { useGateway } from '../gateway/gatewayContext'
import type { InvestigationGateway } from '../gateway/types'
import { useResource } from '../hooks/useResource'
import { BUSY_STATUSES, STATUS_LABEL } from '../lib/labels'

export function InvestigationPage() {
  const gateway = useGateway()
  const { id = '' } = useParams()
  if (!gateway) {
    return <ErrorState title="Backend not connected" message="EvidenceOS has no backend configured, so this investigation cannot be loaded." />
  }
  return <InvestigationView gateway={gateway} id={id} />
}

function InvestigationView({ gateway, id }: { gateway: InvestigationGateway; id: string }) {
  const investigation = useResource(() => gateway.getInvestigation(id), { shouldPoll: (inv) => BUSY_STATUSES.includes(inv.status) })
  const busy = investigation.resource.status === 'ready' && BUSY_STATUSES.includes(investigation.resource.data.status)
  const claims = useResource(() => gateway.listClaims(id), { shouldPoll: () => busy })
  const evidence = useResource(() => gateway.listEvidence(id))
  const changes = useResource(() => gateway.listEvidenceChanges(id))
  const [actionError, setActionError] = useState<string | null>(null)

  const status = investigation.resource.status === 'ready' ? investigation.resource.data.status : null
  // Re-read the dependent data whenever the persisted status moves, so partial results appear as they exist.
  useEffect(() => {
    if (status) {
      claims.reload()
      evidence.reload()
      changes.reload()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function refresh() {
    setActionError(null)
    const result = await gateway.refreshEvidence(id)
    if (result.ok) investigation.reload()
    else setActionError(result.error.message)
  }

  if (investigation.resource.status === 'loading') return <LoadingState label="Loading investigation" />
  if (investigation.resource.status === 'error') {
    return <ErrorState title="Investigation unavailable" message={investigation.resource.error.message} onRetry={investigation.reload} />
  }

  const current = investigation.resource.data
  const known = current.status as InvestigationStatus
  return (
    <article>
      <p className="eyebrow">Investigation · {STATUS_LABEL[known] ?? current.status}</p>
      <h1>{current.question}</h1>
      <ProgressSteps status={known} />

      {known === 'ERROR' ? (
        <ErrorState title="The investigation stopped with an error" message="Work completed before the error is kept. You can retry the research." onRetry={() => void refresh()} />
      ) : null}
      {known === 'REVIEW_REQUIRED' ? (
        <PartialNotice title="Some claims need review">
          Part of the research or assessment could not be completed. Claims below show only what was actually established; unassessed claims are marked as such.
        </PartialNotice>
      ) : null}
      {actionError ? <p className="field__error" role="alert">{actionError}</p> : null}

      <h2>Claims</h2>
      {claims.resource.status === 'loading' ? <LoadingState label="Loading claims" /> : null}
      {claims.resource.status === 'error' ? <ErrorState title="Claims unavailable" message={claims.resource.error.message} onRetry={claims.reload} /> : null}
      {claims.resource.status === 'ready' && claims.resource.data.length === 0 ? (
        <EmptyState title={busy ? 'Claims are being prepared' : 'No claims were produced'}>
          {busy ? 'They appear here as soon as they are saved.' : 'The question could not be broken into researchable claims.'}
        </EmptyState>
      ) : null}
      {claims.resource.status === 'ready' && claims.resource.data.length > 0 ? (
        <ul className="claims">
          {claims.resource.data.map((claim) => <ClaimCard key={claim.id} claim={claim} investigationId={id} />)}
        </ul>
      ) : null}

      {!busy ? (
        <p className="actions">
          <Link className="button button--quiet" to={`/investigations/${id}/graph`}>View evidence graph</Link>
          <Button variant="quiet" onClick={() => void refresh()}>Check for new evidence</Button>
        </p>
      ) : null}

      <h2>State history</h2>
      {changes.resource.status === 'ready' && evidence.resource.status === 'ready' ? (
        <HistoryList
          changes={changes.resource.data}
          evidence={evidence.resource.data}
          {...(claims.resource.status === 'ready' ? { claims: claims.resource.data } : {})}
        />
      ) : <LoadingState label="Loading history" />}
    </article>
  )
}
