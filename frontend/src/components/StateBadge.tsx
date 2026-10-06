import type { ClaimState } from '../api/contracts'

const PRESENTATION: Record<ClaimState, { glyph: string; label: string }> = {
  SUPPORTED: { glyph: '✓', label: 'Supported' },
  PARTIALLY_SUPPORTED: { glyph: '◐', label: 'Partially supported' },
  CONFLICTING: { glyph: '≠', label: 'Conflicting' },
  INSUFFICIENT: { glyph: '?', label: 'Insufficient evidence' },
}

/** Shows a persisted claim state. Meaning is carried by glyph and text, never by color alone. */
export function StateBadge({ state }: { state: ClaimState | null }) {
  if (state === null) {
    return <span className="badge badge--none"><span aria-hidden="true">–</span> Not yet assessed</span>
  }
  const { glyph, label } = PRESENTATION[state]
  return (
    <span className={`badge badge--${state.toLowerCase()}`}>
      <span aria-hidden="true">{glyph}</span> {label}
    </span>
  )
}
