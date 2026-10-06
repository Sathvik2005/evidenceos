import { Link, useParams } from 'react-router-dom'
import type { Claim, Evidence, EvidenceChange, Source } from '../api/contracts'
import { ConfidenceNote } from '../components/ClaimCard'
import { EvidenceCard } from '../components/EvidenceCard'
import { HistoryList } from '../components/HistoryList'
import { StateBadge } from '../components/StateBadge'
import { ErrorState, LoadingState, PartialNotice } from '../components/StatusViews'
import { useGateway } from '../gateway/gatewayContext'
import type { InvestigationGateway } from '../gateway/types'
import { useResource } from '../hooks/useResource'
import { formatDate, safeHref } from '../lib/labels'

export function ClaimDetailPage() {
  const gateway = useGateway()
  const { id = '', claimId = '' } = useParams()
  if (!gateway) return <ErrorState title="Backend not connected" message="EvidenceOS has no backend configured, so this claim cannot be loaded." />
  return <ClaimDetail gateway={gateway} investigationId={id} claimId={claimId} />
}

interface Bundle {
  claim: Claim
  evidence: Evidence[]
  sources: Source[]
  changes: EvidenceChange[]
}

function ClaimDetail({ gateway, investigationId, claimId }: { gateway: InvestigationGateway; investigationId: string; claimId: string }) {
  const { resource, reload } = useResource<Bundle>(async () => {
    const [claims, evidence, sources, changes] = await Promise.all([
      gateway.listClaims(investigationId), gateway.listEvidence(investigationId),
      gateway.listSources(investigationId), gateway.listEvidenceChanges(investigationId),
    ])
    if (!claims.ok) return claims
    if (!evidence.ok) return evidence
    if (!sources.ok) return sources
    if (!changes.ok) return changes
    const claim = claims.data.find((c) => c.id === claimId)
    if (!claim) return { ok: false, error: { code: 'NOT_FOUND', message: 'This claim does not exist in the investigation.' } }
    return {
      ok: true,
      data: {
        claim,
        evidence: evidence.data.filter((e) => e.claimId === claimId),
        sources: sources.data,
        changes: changes.data.filter((c) => c.claimId === claimId),
      },
    }
  })

  if (resource.status === 'loading') return <LoadingState label="Loading claim" />
  if (resource.status === 'error') return <ErrorState title="Claim unavailable" message={resource.error.message} onRetry={reload} />

  const { claim, evidence, sources, changes } = resource.data
  const sourceOf = (e: Evidence) => sources.find((s) => s.id === e.sourceId)
  const supporting = evidence.filter((e) => e.relationship === 'SUPPORTS' || e.relationship === 'PARTIALLY_SUPPORTS')
  const contradicting = evidence.filter((e) => e.relationship === 'CONTRADICTS')
  const uncertain = evidence.filter((e) => e.relationship === 'INSUFFICIENT')
  const usedSources = sources.filter((s) => evidence.some((e) => e.sourceId === s.id))

  return (
    <article>
      <p><Link to={`/investigations/${investigationId}`}>← Investigation</Link></p>
      <h1>{claim.statement}</h1>
      <p className="claim__meta">
        <StateBadge state={claim.state} /> <ConfidenceNote confidence={claim.confidence} />
      </p>

      <section aria-labelledby="why">
        <h2 id="why">Why</h2>
        {claim.assessmentReason ? <p>{claim.assessmentReason}</p> : <p className="muted">No assessment has been recorded for this claim yet.</p>}
      </section>

      <section aria-labelledby="supporting">
        <h2 id="supporting">Supporting evidence</h2>
        {supporting.length === 0 ? <p className="muted">No supporting evidence is recorded.</p> : supporting.map((e) => <EvidenceCard key={e.id} evidence={e} source={sourceOf(e)} />)}
      </section>

      <section aria-labelledby="contradicting" className="contradictions">
        <h2 id="contradicting">Contradictory evidence</h2>
        {contradicting.length === 0
          ? <p className="muted">No contradicting evidence is recorded for this claim.</p>
          : contradicting.map((e) => <EvidenceCard key={e.id} evidence={e} source={sourceOf(e)} />)}
      </section>

      <section aria-labelledby="uncertainty">
        <h2 id="uncertainty">Uncertainty</h2>
        {claim.state === 'INSUFFICIENT' ? (
          <PartialNotice title="Insufficient evidence">The retained evidence is not enough to support or contradict this claim.</PartialNotice>
        ) : null}
        {uncertain.length > 0 ? uncertain.map((e) => <EvidenceCard key={e.id} evidence={e} source={sourceOf(e)} />) : null}
        {claim.state !== 'INSUFFICIENT' && uncertain.length === 0 ? <p className="muted">Confidence is {claim.confidence ? claim.confidence.toLowerCase() : 'not assessed'}; no evidence was flagged as insufficient.</p> : null}
      </section>

      <section aria-labelledby="sources">
        <h2 id="sources">Sources</h2>
        {usedSources.length === 0 ? <p className="muted">No sources are attached to this claim.</p> : (
          <ul>
            {usedSources.map((s) => {
              const href = safeHref(s.url)
              return <li key={s.id}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title} · retrieved from {new URL(s.url).host} · {formatDate(s.publishedAt)}</li>
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="history">
        <h2 id="history">History</h2>
        <HistoryList changes={changes} evidence={evidence} />
      </section>
    </article>
  )
}
