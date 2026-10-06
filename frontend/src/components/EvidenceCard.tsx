import type { Evidence, Source } from '../api/contracts'
import { RELATIONSHIP_LABEL, STRENGTH_LABEL, formatDate, safeHref } from '../lib/labels'

const GLYPH: Record<Evidence['relationship'], string> = {
  SUPPORTS: '＋',
  PARTIALLY_SUPPORTS: '◐',
  CONTRADICTS: '≠',
  INSUFFICIENT: '?',
}

/** The evidence excerpt is the centerpiece; provenance sits directly beneath it. */
export function EvidenceCard({ evidence, source }: { evidence: Evidence; source: Source | undefined }) {
  const href = source ? safeHref(source.url) : null
  return (
    <figure className={`evidence evidence--${evidence.relationship.toLowerCase()}`}>
      <figcaption className="evidence__meta">
        <span className="evidence__relationship">
          <span aria-hidden="true">{GLYPH[evidence.relationship]}</span> {RELATIONSHIP_LABEL[evidence.relationship]}
        </span>
        <span>Strength: {STRENGTH_LABEL[evidence.strength]}</span>
      </figcaption>
      <blockquote className="evidence__excerpt">{evidence.excerpt}</blockquote>
      {evidence.reasoning ? <p className="evidence__reasoning">Why it matters: {evidence.reasoning}</p> : null}
      <p className="evidence__provenance">
        {source ? (
          <>
            {href ? <a href={href} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}
            {source.publisher ? ` · ${source.publisher}` : ''} · published {formatDate(source.publishedAt)}
          </>
        ) : (
          'Source record unavailable'
        )}
      </p>
    </figure>
  )
}
