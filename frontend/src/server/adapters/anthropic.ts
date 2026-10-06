// Anthropic model adapter behind the provider-neutral LlmClient. Server-side only: it holds the key.
import Anthropic from '@anthropic-ai/sdk'
import type { LlmClient, LlmRequest } from '../../agents/llm'
import { WorkflowError, type FailureKind } from '../../workflow/types'

export interface AnthropicOptions {
  readonly apiKey: string
  readonly model: string
  readonly maxTokens?: number
  readonly timeoutMs?: number
}

/** Extracts the JSON value from a model reply that may be wrapped in a code fence or prose. */
export function parseModelJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.search(/[{[]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start === -1 || end <= start) throw new WorkflowError('MALFORMED_OUTPUT', 'The model reply contained no JSON.')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch (error) {
    throw new WorkflowError('MALFORMED_OUTPUT', 'The model reply was not valid JSON.', { cause: error })
  }
}

export function classifyProviderError(error: unknown): FailureKind {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'TIMEOUT'
  if (error instanceof Anthropic.APIConnectionError) return 'NETWORK'
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0
    if (status === 401 || status === 403) return 'AUTHENTICATION'
    if (status === 429) return 'RATE_LIMIT'
    if (status === 408) return 'TIMEOUT'
    if (status >= 500) return 'PROVIDER'
  }
  return 'WORKFLOW'
}

export function createAnthropicLlm(options: AnthropicOptions): LlmClient {
  const client = new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 60_000, maxRetries: 0 })
  return {
    async generate(request: LlmRequest): Promise<unknown> {
      let text: string
      try {
        const response = await client.messages.create({
          model: options.model,
          max_tokens: options.maxTokens ?? 4096,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        })
        text = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
      } catch (error) {
        // The provider message can echo request details, so only the classified kind is surfaced.
        throw new WorkflowError(classifyProviderError(error), 'The language model request failed.', { cause: error })
      }
      return parseModelJson(text)
    },
  }
}
