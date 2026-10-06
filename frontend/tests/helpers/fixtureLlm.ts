// Deterministic test double for the whole model boundary. It reads only what the prompts
// contain and answers by schema name. It is never used by application code.
import type { LlmClient, LlmRequest } from '../../src/agents/llm'

export interface FixtureOptions {
  readonly claims?: readonly string[]
  /** Override the research answer for a schema call, e.g. to inject a fabricated quote. */
  readonly research?: (request: LlmRequest) => unknown
}

export const DEFAULT_CLAIMS = [
  'Remote learning changes standardized test scores',
  'Remote learning changes student attendance rates',
  'Remote learning changes student wellbeing',
] as const

function researchAnswer(request: LlmRequest) {
  const candidates = [...request.user.matchAll(/<document index="(\d+)">\n([\s\S]*?)\n<\/document>/g)].map((match) => ({
    documentIndex: Number(match[1]),
    excerpt: match[2] ?? '',
    relationship: /declined|fell/.test(match[2] ?? '') ? 'CONTRADICTS' : /partly/.test(match[2] ?? '') ? 'PARTIALLY_SUPPORTS' : 'SUPPORTS',
    strength: 'MODERATE',
  }))
  return { candidates }
}

function assessmentAnswer(request: LlmRequest) {
  const items = [...request.user.matchAll(/<evidence id="([^"]+)" relationship="([^"]+)"/g)].map((m) => ({ id: m[1] ?? '', relationship: m[2] ?? '' }))
  const supports = items.some((i) => i.relationship === 'SUPPORTS')
  const partial = items.some((i) => i.relationship === 'PARTIALLY_SUPPORTS')
  const contradicts = items.some((i) => i.relationship === 'CONTRADICTS')
  const proposedState =
    contradicts && (supports || partial) ? 'CONFLICTING' : supports && !contradicts ? 'SUPPORTED' : partial ? 'PARTIALLY_SUPPORTED' : 'INSUFFICIENT'
  return {
    proposedState,
    confidence: 'MEDIUM',
    rationale: 'Assessment derived from the supplied evidence.',
    evidenceIds: items.map((i) => i.id),
    causalStatus: 'CORRELATION',
    scopeNotes: [],
    uncertainties: [],
  }
}

export function fixtureLlm(options: FixtureOptions = {}): LlmClient & { readonly calls: Record<string, number> } {
  const calls: Record<string, number> = {}
  return {
    calls,
    async generate(request) {
      calls[request.schemaName] = (calls[request.schemaName] ?? 0) + 1
      switch (request.schemaName) {
        case 'claim_decomposition':
          return { claims: (options.claims ?? DEFAULT_CLAIMS).map((statement) => ({ statement })) }
        case 'research_candidates':
          return options.research ? options.research(request) : researchAnswer(request)
        case 'evidence_assessment':
          return assessmentAnswer(request)
        case 'evaluation':
          return {
            scores: { evidenceQuality: 2, grounding: 2, contradictionHandling: 2, stateJustification: 2, uncertaintyHandling: 2 },
            criticalFailures: [],
            findings: [],
          }
        default:
          throw new Error(`Unexpected schema ${request.schemaName}`)
      }
    },
  }
}
