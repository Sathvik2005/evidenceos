import type { Claim, Evidence, EvidenceRelationship, Source } from '../api/contracts'

export type GraphNodeKind = 'claim' | 'evidence' | 'source'
export type GraphEdgeKind = EvidenceRelationship | 'CITES'

export interface GraphNode {
  readonly id: string
  readonly kind: GraphNodeKind
  readonly label: string
  /** Full detail shown when the node is inspected; always real persisted text. */
  readonly detail: string
  readonly href?: string
}

export interface GraphEdge {
  readonly from: string
  readonly to: string
  readonly kind: GraphEdgeKind
}

export interface EvidenceGraph {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/**
 * Claim ↔ Evidence ↔ Source, built only from persisted records. Evidence that references a record
 * that is not present is skipped rather than invented.
 */
export function buildEvidenceGraph(claims: readonly Claim[], evidence: readonly Evidence[], sources: readonly Source[]): EvidenceGraph {
  const claimIds = new Set(claims.map((c) => c.id))
  const sourceIds = new Set(sources.map((s) => s.id))
  const usable = evidence.filter((e) => claimIds.has(e.claimId) && sourceIds.has(e.sourceId))
  const usedSources = new Set(usable.map((e) => e.sourceId))

  const nodes: GraphNode[] = [
    ...claims.map((c): GraphNode => ({ id: `claim:${c.id}`, kind: 'claim', label: clip(c.statement, 34), detail: c.statement })),
    ...usable.map((e): GraphNode => ({ id: `evidence:${e.id}`, kind: 'evidence', label: clip(e.excerpt, 34), detail: e.excerpt })),
    ...sources
      .filter((s) => usedSources.has(s.id))
      .map((s): GraphNode => ({ id: `source:${s.id}`, kind: 'source', label: clip(s.title, 34), detail: `${s.title} — ${s.url}`, href: s.url })),
  ]
  const edges: GraphEdge[] = usable.flatMap((e): GraphEdge[] => [
    { from: `claim:${e.claimId}`, to: `evidence:${e.id}`, kind: e.relationship },
    { from: `evidence:${e.id}`, to: `source:${e.sourceId}`, kind: 'CITES' },
  ])
  return { nodes, edges }
}
