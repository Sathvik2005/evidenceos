import type { ReactNode } from 'react'
import { Button } from './Button'

/** Indeterminate by design: it never implies a percentage of backend progress. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div className="status" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="status status--empty">
      <h2 className="status__title">{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  )
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="status status--error" role="alert">
      <h2 className="status__title">{title}</h2>
      <p>{message}</p>
      {onRetry ? <Button variant="quiet" onClick={onRetry}>Try again</Button> : null}
    </div>
  )
}

/** For results that are real but incomplete: say what is missing instead of hiding it. */
export function PartialNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="status status--partial" role="note">
      <strong className="status__title">{title}</strong>
      <p>{children}</p>
    </div>
  )
}
