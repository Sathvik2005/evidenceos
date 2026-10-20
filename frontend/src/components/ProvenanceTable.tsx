import type { Evidence, Source } from '../api/contracts'
import { RELATIONSHIP_LABEL, STRENGTH_LABEL, formatDate, safeHref } from '../lib/labels'

const GLYPH: Record<Evidence['relationship'], string> = { SUPPORTS: '＋', PARTIALLY_SUPPORTS: '◐', CONTRADICTS: '≠', INSUFFICIENT: '?' }

/** Contradictions first, so disagreement is the first thing a reader sees; nothing is hidden or merged. */
const ORDER: Record<Evidence['relationship'], number> = { CONTRADICTS: 0, PARTIALLY_SUPPORTS: 1, SUPPORTS: 2, INSUFFICIENT: 3 }

/** Every piece of evidence for a claim, one row each, with its source details side by side. */
export function ProvenanceTable({ evidence, sources }: { evidence: readonly Evidence[]; sources: readonly Source[] }) {
  if (evidence.length === 0) return null
  const rows = [...evidence].sort((a, b) => ORDER[a.relationship] - ORDER[b.relationship])
  return (
    <div className="provenance" role="region" aria-labelledby="provenance-caption" tabIndex={0}>
      <table>
        <caption id="provenance-caption">Provenance: where each piece of evidence came from, contradictions first</caption>
        <thead>
          <tr>
            <th scope="col">Relationship</th>
            <th scope="col">Excerpt</th>
            <th scope="col">Source</th>
            <th scope="col">Publisher</th>
            <th scope="col">Published</th>
            <th scope="col">Strength</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const source = sources.find((s) => s.id === e.sourceId)
            const href = source ? safeHref(source.url) : null
            return (
              <tr key={e.id} className={`provenance__row--${e.relationship.toLowerCase()}`}>
                <th scope="row">
                  <span aria-hidden="true">{GLYPH[e.relationship]}</span> {RELATIONSHIP_LABEL[e.relationship]}
                </th>
                <td className="provenance__excerpt">“{e.excerpt}”</td>
                <td>{source ? (href ? <a href={href} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title) : 'Source record unavailable'}</td>
                <td>{source?.publisher ?? 'Not recorded'}</td>
                <td>{source ? formatDate(source.publishedAt) : 'Not recorded'}</td>
                <td>{STRENGTH_LABEL[e.strength]}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
