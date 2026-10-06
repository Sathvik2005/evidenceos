// In-memory stand-in for the EvidenceOS HTTP API, used only by the UI tests. The real behavior (workflow,
// validation, persistence, change detection) is tested in the Python backend; here the data is fixed so the
// UI can be checked for how it renders each state. Record shapes are pinned by tests/fixtures/wire.json.
import type {
  ApiResult, Claim, Evidence, EvidenceChange, Investigation, Source,
} from '../../src/api/contracts'
import type { InvestigationGateway } from '../../src/gateway/types'

export interface Records {
  investigations: Investigation[]
  claims: Claim[]
  sources: Source[]
  evidence: Evidence[]
  changes: EvidenceChange[]
}

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data })
const notFound = (): ApiResult<never> => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Investigation not found.' } })

export class FakeBackend implements InvestigationGateway {
  readonly runs: string[] = []
  demoId: string | null = null
  private records: Records
  private nextId = 1

  constructor(records: Partial<Records> = {}) {
    this.records = { investigations: [], claims: [], sources: [], evidence: [], changes: [], ...records }
  }

  /** Replaces the stored records, as if the server had finished another step. */
  load(records: Partial<Records>): void {
    this.records = { ...this.records, ...records }
  }

  setStatus(id: string, status: string): void {
    this.records.investigations = this.records.investigations.map((i) => (i.id === id ? { ...i, status } : i))
  }

  private has(id: string): boolean {
    return this.records.investigations.some((i) => i.id === id)
  }

  async createInvestigation(input: { question: string; idempotencyKey?: string }): Promise<ApiResult<Investigation>> {
    if (!input.question.trim()) {
      return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'question must be a non-empty string.', field: 'question' } }
    }
    const now = '2026-01-01T00:00:00.000Z'
    const created: Investigation = { id: `inv-${this.nextId++}`, question: input.question, status: 'CREATED', createdAt: now, updatedAt: now }
    this.records.investigations = [...this.records.investigations, created]
    this.runs.push(created.id)
    return ok(created)
  }

  async getInvestigation(id: string): Promise<ApiResult<Investigation>> {
    const found = this.records.investigations.find((i) => i.id === id)
    return found ? ok(found) : notFound()
  }

  async listClaims(id: string): Promise<ApiResult<Claim[]>> {
    return this.has(id) ? ok(this.records.claims.filter((c) => c.investigationId === id)) : notFound()
  }

  async listEvidence(id: string): Promise<ApiResult<Evidence[]>> {
    return this.has(id) ? ok(this.records.evidence.filter((e) => e.investigationId === id)) : notFound()
  }

  async listSources(id: string): Promise<ApiResult<Source[]>> {
    return this.has(id) ? ok(this.records.sources.filter((s) => s.investigationId === id)) : notFound()
  }

  async listEvidenceChanges(id: string): Promise<ApiResult<EvidenceChange[]>> {
    return this.has(id) ? ok(this.records.changes.filter((c) => c.investigationId === id)) : notFound()
  }

  async getDemoInvestigation(): Promise<ApiResult<{ investigationId: string | null }>> {
    return ok({ investigationId: this.demoId })
  }

  async refreshEvidence(id: string): Promise<ApiResult<Investigation>> {
    const found = await this.getInvestigation(id)
    if (found.ok) this.runs.push(id)
    return found
  }
}

// ---- scenario data -----------------------------------------------------------------------------------------

export const INV = 'inv-1'
export const QUESTION = 'Does remote learning improve student outcomes?'
const AT = '2026-01-01T00:00:00.000Z'

export const TEXT = {
  partly: 'Remote students partly improved reading scores in one district.',
  declined: 'Average math scores declined after the move to remote learning.',
  attendance: 'Remote students improved attendance rates in rural schools.',
}

const source = (slug: string): Source => ({
  id: `s-${slug}`, investigationId: INV, sourceType: 'JOURNAL_ARTICLE', url: `https://example.org/${slug}`,
  title: `Source ${slug}`, publisher: 'Example Journal', publishedAt: '2022-05-01T00:00:00.000Z',
})

const claim = (n: number, statement: string, state: Claim['state'], confidence: Claim['confidence']): Claim => ({
  id: `c${n}`, investigationId: INV, ordinal: n, statement, state, confidence, assessmentReason: state ? 'Assessed from the evidence.' : null,
})

const evidence = (
  id: string, claimId: string, slug: string, relationship: Evidence['relationship'], excerpt: string, reasoning: string | null = null,
): Evidence => ({
  id, investigationId: INV, claimId, sourceId: `s-${slug}`, relationship, strength: 'MODERATE', excerpt, reasoning,
})

export const CLAIMS = {
  scores: 'Remote learning changes standardized test scores',
  attendance: 'Remote learning changes student attendance rates',
  wellbeing: 'Remote learning changes student wellbeing',
}

const investigation = (status: string): Investigation => ({ id: INV, question: QUESTION, status, createdAt: AT, updatedAt: AT })

/** Claim 1 CONFLICTING after new evidence, claim 2 SUPPORTED, claim 3 INSUFFICIENT; one recorded change. */
export function conflictingScenario(): Records {
  return {
    investigations: [investigation('READY')],
    claims: [
      claim(1, CLAIMS.scores, 'CONFLICTING', 'MEDIUM'),
      claim(2, CLAIMS.attendance, 'SUPPORTED', 'MEDIUM'),
      claim(3, CLAIMS.wellbeing, 'INSUFFICIENT', 'LOW'),
    ],
    sources: [source('scores-partly'), source('scores-down'), source('attendance')],
    evidence: [
      evidence('e1', 'c1', 'scores-partly', 'PARTIALLY_SUPPORTS', TEXT.partly),
      evidence('e2', 'c1', 'scores-down', 'CONTRADICTS', TEXT.declined),
      evidence('e3', 'c2', 'attendance', 'SUPPORTS', TEXT.attendance),
    ],
    changes: [{
      id: 'ch1', investigationId: INV, claimId: 'c1', previousState: 'PARTIALLY_SUPPORTED', newState: 'CONFLICTING',
      reason: 'New contradicting evidence arrived.', triggeringEvidenceId: 'e2', changedAt: AT,
    }],
  }
}

/** Before the new evidence: claim 1 is only PARTIALLY_SUPPORTED and there is no history yet. */
export function partialScenario(): Records {
  const full = conflictingScenario()
  return {
    ...full,
    claims: [claim(1, CLAIMS.scores, 'PARTIALLY_SUPPORTED', 'LOW'), ...full.claims.slice(1)],
    evidence: full.evidence.filter((e) => e.id !== 'e2'),
    changes: [],
  }
}

export const SEED_LABEL = 'Seed fixture (authored, not model output):'

/** Authored demo data: two contradicting items plus the earlier partial one, all labelled as seed data. */
export function seededConflictScenario(): Records {
  const full = conflictingScenario()
  return {
    ...full,
    evidence: [
      evidence('e1', 'c1', 'scores-partly', 'PARTIALLY_SUPPORTS', TEXT.partly, `${SEED_LABEL} an older, pre-pandemic synthesis.`),
      evidence('e2', 'c1', 'scores-down', 'CONTRADICTS', TEXT.declined, `${SEED_LABEL} a randomized college experiment.`),
      evidence('e4', 'c1', 'attendance', 'CONTRADICTS', 'More remote schooling was associated with larger test-score declines.', `${SEED_LABEL} district data.`),
    ],
  }
}
