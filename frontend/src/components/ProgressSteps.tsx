import type { InvestigationStatus } from '../api/contracts'
import { BUSY_STATUSES, STATUS_LABEL, describeStep } from '../lib/labels'

const STEPS: readonly InvestigationStatus[] = ['CREATED', 'RESEARCHING', 'ANALYZING', 'READY']

/**
 * Shows the stage the backend reports. There is no percentage and no animation of progress: the
 * highlighted step changes only when the persisted investigation status changes.
 */
export function ProgressSteps({ status, node = null }: { status: InvestigationStatus; node?: string | null }) {
  const terminal = status === 'REVIEW_REQUIRED' || status === 'ERROR'
  const index = terminal ? -1 : STEPS.indexOf(status)
  const step = describeStep(node)
  const busy = BUSY_STATUSES.includes(status)
  return (
    <>
    <ol className="steps" aria-label="Investigation stage">
      {STEPS.map((step, i) => (
        <li key={step} className="steps__item" aria-current={i === index ? 'step' : undefined} data-done={index > i}>
          {STATUS_LABEL[step]}
        </li>
      ))}
      {terminal ? <li className="steps__item steps__item--end" aria-current="step">{STATUS_LABEL[status]}</li> : null}
    </ol>
    {/* The live region exists before its text does, so assistive technology announces each new step. */}
    <p className="steps__now" role="status">
      {step && busy ? `Step ${step.position} of ${step.total}: ${step.label}` : null}
      {step && status === 'ERROR' ? `Stopped at step ${step.position} of ${step.total}: ${step.label}` : null}
    </p>
    </>
  )
}
