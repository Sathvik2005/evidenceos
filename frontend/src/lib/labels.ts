import type { ConfidenceLevel, EvidenceRelationship, EvidenceStrength, InvestigationStatus } from '../api/contracts'

export const STATUS_LABEL: Record<InvestigationStatus, string> = {
  CREATED: 'Created',
  RESEARCHING: 'Researching',
  ANALYZING: 'Analyzing',
  READY: 'Ready',
  REVIEW_REQUIRED: 'Review required',
  ERROR: 'Error',
}

export const BUSY_STATUSES: readonly string[] = ['CREATED', 'RESEARCHING', 'ANALYZING']

export const RELATIONSHIP_LABEL: Record<EvidenceRelationship, string> = {
  SUPPORTS: 'Supports',
  PARTIALLY_SUPPORTS: 'Partially supports',
  CONTRADICTS: 'Contradicts',
  INSUFFICIENT: 'Insufficient to judge',
}

export const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  STRONG: 'Strong',
  MODERATE: 'Moderate',
  WEAK: 'Weak',
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
}

export function formatDate(value: string | null): string {
  if (!value) return 'unknown date'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'unknown date' : date.toISOString().slice(0, 10)
}

/** Only http(s) URLs are ever turned into links. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** Plain-language reason for a stopped run, keyed by the server's classified failure kind. */
export const FAILURE_MESSAGE: Record<string, string> = {
  RATE_LIMIT: 'The language model provider is rate-limiting this server or its quota is used up. Retrying later may work.',
  AUTHENTICATION: 'The server could not authenticate with the language model or search provider. This needs an operator to fix the configured key.',
  AUTHORIZATION: 'The language model provider refused the request, most likely because the account has no credit left. This needs an operator to fix the account.',
  TIMEOUT: 'A provider took too long to respond. Retrying may work.',
  NETWORK: 'The server could not reach a provider. Retrying may work.',
  PROVIDER: 'A provider returned an error. Retrying may work.',
  MALFORMED_OUTPUT: 'The language model returned output that did not pass validation, so it was not used.',
  VALIDATION: 'A result did not pass the evidence validation rules, so it was not stored.',
  PERSISTENCE: 'The server could not save its progress to the database.',
  WORKFLOW: 'The run stopped unexpectedly.',
}

export const failureMessage = (kind: string | null): string =>
  (kind !== null ? FAILURE_MESSAGE[kind] : undefined) ?? 'The reason was not recorded.'

/** The server's workflow steps in the order they run, with plain-language labels. */
export const WORKFLOW_STEPS: readonly { readonly node: string; readonly label: string }[] = [
  { node: 'load', label: 'Loading the investigation' },
  { node: 'decompose', label: 'Breaking the question into claims' },
  { node: 'validateClaims', label: 'Checking the claims' },
  { node: 'persistClaims', label: 'Saving the claims' },
  { node: 'research', label: 'Researching sources' },
  { node: 'validateEvidence', label: 'Checking quotes and sources' },
  { node: 'analyze', label: 'Weighing the evidence' },
  { node: 'validateAssessment', label: 'Checking the assessment' },
  { node: 'evaluate', label: 'Auditing the assessment' },
  { node: 'decide', label: 'Deciding what to keep' },
  { node: 'persistState', label: 'Saving claim states' },
  { node: 'detectChange', label: 'Looking for changes' },
  { node: 'summarize', label: 'Summarizing' },
]

/** "Step 5 of 13: Researching sources", or null when the step is unknown. Never invented from the status. */
export function describeStep(node: string | null): { readonly position: number; readonly total: number; readonly label: string } | null {
  const index = node === null ? -1 : WORKFLOW_STEPS.findIndex((s) => s.node === node)
  const step = WORKFLOW_STEPS[index]
  return step ? { position: index + 1, total: WORKFLOW_STEPS.length, label: step.label } : null
}
