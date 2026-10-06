// Test double only: replays scripted model outputs. Never used by application code.
import type { LlmClient, LlmRequest } from '../../src/agents/llm'

export function scriptedLlm(...outputs: (unknown | Error)[]): LlmClient & { readonly requests: LlmRequest[] } {
  const requests: LlmRequest[] = []
  let index = 0
  return {
    requests,
    async generate(request) {
      requests.push(request)
      const next = outputs[Math.min(index, outputs.length - 1)]
      index += 1
      if (next instanceof Error) throw next
      return next
    },
  }
}
