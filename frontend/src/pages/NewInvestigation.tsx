import { useId, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { ErrorState } from '../components/StatusViews'
import { useGateway } from '../gateway/gatewayContext'

const MAX_QUESTION = 2000

export function NewInvestigation() {
  const gateway = useGateway()
  const navigate = useNavigate()
  const fieldId = useId()
  const [question, setQuestion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // One key per form instance: a double submit or a retry cannot create a second investigation.
  const idempotencyKey = useRef(crypto.randomUUID())

  if (!gateway) {
    return <ErrorState title="Backend not connected" message="EvidenceOS has no backend configured, so an investigation cannot be started." />
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed) return setError('Enter a question to investigate.')
    if (trimmed.length > MAX_QUESTION) return setError(`Keep the question under ${MAX_QUESTION} characters.`)
    setError(null)
    setSubmitting(true)
    const result = await gateway!.createInvestigation({ question: trimmed, idempotencyKey: idempotencyKey.current })
    setSubmitting(false)
    if (result.ok) navigate(`/investigations/${result.data.id}`)
    else setError(result.error.message)
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <h1>Begin an investigation</h1>
      <div className="field">
        <label htmlFor={fieldId}>Question</label>
        <textarea
          id={fieldId} rows={4} value={question} maxLength={MAX_QUESTION} disabled={submitting}
          onChange={(e) => setQuestion(e.target.value)} aria-invalid={error ? true : undefined}
          aria-describedby={`${fieldId}-hint${error ? ` ${fieldId}-error` : ''}`}
          placeholder="Does remote learning improve student outcomes?"
        />
        <p id={`${fieldId}-hint`} className="field__hint">One question. EvidenceOS breaks it into claims and gathers sourced evidence for each.</p>
        {error ? <p id={`${fieldId}-error`} className="field__error" role="alert">{error}</p> : null}
      </div>
      <Button type="submit" variant="primary" disabled={submitting}>{submitting ? 'Starting…' : 'Start investigation'}</Button>
    </form>
  )
}
