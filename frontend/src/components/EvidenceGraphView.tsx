import { useState } from 'react'
import type { EvidenceGraph, GraphEdge, GraphNode } from '../graph/buildGraph'
import { RELATIONSHIP_LABEL, safeHref } from '../lib/labels'
import type { EvidenceRelationship } from '../api/contracts'

const COLUMN_X: Record<GraphNode['kind'], number> = { claim: 20, evidence: 330, source: 640 }
const NODE_W = 260
const NODE_H = 44
const ROW = 66

function layout(nodes: readonly GraphNode[]) {
  const rows: Record<GraphNode['kind'], number> = { claim: 0, evidence: 0, source: 0 }
  const position = new Map<string, { x: number; y: number }>()
  for (const node of nodes) {
    position.set(node.id, { x: COLUMN_X[node.kind], y: 20 + rows[node.kind] * ROW })
    rows[node.kind] += 1
  }
  return { position, height: 40 + Math.max(1, rows.claim, rows.evidence, rows.source) * ROW }
}

function edgeLabel(edge: GraphEdge): string {
  return edge.kind === 'CITES' ? 'cites' : RELATIONSHIP_LABEL[edge.kind as EvidenceRelationship].toLowerCase()
}

/** Dashed + labelled contradictions: the distinction never relies on color alone. */
export function EvidenceGraphView({ graph }: { graph: EvidenceGraph }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { position, height } = layout(graph.nodes)
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const selected = selectedId ? byId.get(selectedId) : undefined

  if (graph.nodes.length === 0) return <p className="muted">There is nothing to graph yet.</p>

  return (
    <div>
      <div className="graph" role="group" aria-label="Evidence graph. A full text version follows the diagram.">
        <svg viewBox={`0 0 920 ${height}`} width="100%" role="presentation">
          {graph.edges.map((edge, i) => {
            const a = position.get(edge.from)
            const b = position.get(edge.to)
            if (!a || !b) return null
            const x1 = a.x + NODE_W
            const y1 = a.y + NODE_H / 2
            const x2 = b.x
            const y2 = b.y + NODE_H / 2
            return (
              <g key={`${edge.from}>${edge.to}>${i}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className={`graph__edge graph__edge--${edge.kind.toLowerCase()}`}
                  strokeDasharray={edge.kind === 'CONTRADICTS' ? '6 4' : undefined} />
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle" className="graph__edge-label">{edgeLabel(edge)}</text>
              </g>
            )
          })}
          {graph.nodes.map((node) => {
            const p = position.get(node.id)
            if (!p) return null
            return (
              <g
                key={node.id} role="button" tabIndex={0} aria-pressed={selectedId === node.id}
                aria-label={`${node.kind}: ${node.detail}`}
                className={`graph__node graph__node--${node.kind}${selectedId === node.id ? ' is-selected' : ''}`}
                onClick={() => setSelectedId(node.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(node.id) } }}
              >
                <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={6} />
                <text x={p.x + 10} y={p.y + 27}>{node.label}</text>
              </g>
            )
          })}
        </svg>
      </div>

      <section aria-live="polite" className="graph__inspector">
        <h3>Inspector</h3>
        {selected ? (
          <>
            <p><strong>{selected.kind}</strong></p>
            <p>{selected.detail}</p>
            {selected.href && safeHref(selected.href) ? <p><a href={safeHref(selected.href) ?? undefined} target="_blank" rel="noopener noreferrer">Open source</a></p> : null}
          </>
        ) : <p className="muted">Select a node to inspect its full text and provenance.</p>}
      </section>

      <section aria-labelledby="graph-list">
        <h3 id="graph-list">Relationships (text version)</h3>
        <ul className="graph__list">
          {graph.edges.map((edge, i) => (
            <li key={`${edge.from}>${edge.to}>${i}`}>
              {byId.get(edge.from)?.label} <strong>{edgeLabel(edge)}</strong> {byId.get(edge.to)?.label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
