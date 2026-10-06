import type { InvestigationStatus } from '../api/contracts'
import { STATUS_LABEL } from '../lib/labels'

const STEPS: readonly InvestigationStatus[] = ['CREATED', 'RESEARCHING', 'ANALYZING', 'READY']

/**
 * Shows the stage the backend reports. There is no percentage and no animation of progress: the
 * highlighted step changes only when the persisted investigation status changes.
 */
export function ProgressSteps({ status }: { status: InvestigationStatus }) {
  const terminal = status === 'REVIEW_REQUIRED' || status === 'ERROR'
  const index = terminal ? -1 : STEPS.indexOf(status)
  return (
    <ol className="steps" aria-label="Investigation stage">
      {STEPS.map((step, i) => (
        <li key={step} className="steps__item" aria-current={i === index ? 'step' : undefined} data-done={index > i}>
          {STATUS_LABEL[step]}
        </li>
      ))}
      {terminal ? <li className="steps__item steps__item--end" aria-current="step">{STATUS_LABEL[status]}</li> : null}
    </ol>
  )
}
