// Provider-neutral LLM boundary. The model returns untrusted JSON; every agent validates it
// (schema, then deterministic rules) before anything becomes application state.
import { DEFAULT_MAX_RETRIES, TRANSIENT_FAILURES, WorkflowError } from '../workflow/types'

export interface LlmRequest {
  readonly system: string
  readonly user: string
  /** Names the expected output schema for adapters that support structured output. */
  readonly schemaName: string
}

export interface LlmClient {
  /** Returns the parsed JSON value. Adapters throw WorkflowError for provider failures. */
  generate(request: LlmRequest): Promise<unknown>
}

export type Validation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] }

export const valid = <T>(value: T): Validation<T> => ({ ok: true, value })
export const invalid = (...errors: string[]): Validation<never> => ({ ok: false, errors })

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Rejects fields outside the contract so a model cannot smuggle in e.g. a verdict or an ID. */
export function unauthorizedFields(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key))
}

/**
 * Calls the model and validates the result, retrying only transient provider failures and
 * malformed output, within the bound. Validation feedback is passed back to the model.
 */
export async function runStructured<T>(
  llm: LlmClient,
  request: LlmRequest,
  validate: (raw: unknown) => Validation<T>,
  maxRetries: number = DEFAULT_MAX_RETRIES,
): Promise<T> {
  let feedback: readonly string[] = []
  let last = new WorkflowError('MALFORMED_OUTPUT', 'The model did not return valid structured output.')

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const prompt =
      feedback.length === 0
        ? request
        : { ...request, user: `${request.user}\n\nYour previous output was rejected:\n- ${feedback.join('\n- ')}\nReturn corrected JSON only.` }
    try {
      const result = validate(await llm.generate(prompt))
      if (result.ok) return result.value
      feedback = result.errors
      last = new WorkflowError('MALFORMED_OUTPUT', `Model output failed validation: ${result.errors.join('; ')}`)
    } catch (error) {
      if (!(error instanceof WorkflowError) || !TRANSIENT_FAILURES.has(error.kind)) throw error
      last = error
    }
  }
  throw last
}
