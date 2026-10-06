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
