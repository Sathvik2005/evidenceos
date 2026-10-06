// Tavily retrieval adapter behind SearchProvider. It returns only what the provider returned:
// every URL, title, date and text below comes from the response, never from a model.
import type { RetrievedDocument, SearchOutcome, SearchProvider } from '../../agents/researchAgent'
import { WorkflowError, type FailureKind } from '../../workflow/types'

export interface TavilyOptions {
  readonly apiKey: string
  readonly maxResults?: number
  readonly timeoutMs?: number
  readonly fetchImpl?: typeof fetch
  readonly now?: () => Date
}

interface TavilyResult {
  url?: unknown
  title?: unknown
  content?: unknown
  raw_content?: unknown
  published_date?: unknown
}

function kindForStatus(status: number): FailureKind {
  if (status === 401 || status === 403) return 'AUTHENTICATION'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 408) return 'TIMEOUT'
  return status >= 500 ? 'PROVIDER' : 'WORKFLOW'
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export function createTavilySearch(options: TavilyOptions): SearchProvider {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = options.now ?? (() => new Date())

  return {
    async search(query: string): Promise<SearchOutcome> {
      let response: Response
      try {
        response = await doFetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify({ query, max_results: options.maxResults ?? 6, include_raw_content: 'text', search_depth: 'basic' }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
        })
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        throw new WorkflowError(timedOut ? 'TIMEOUT' : 'NETWORK', 'The search request failed.', { cause: error })
      }
      if (!response.ok) throw new WorkflowError(kindForStatus(response.status), `The search provider returned HTTP ${response.status}.`)

      let body: { results?: unknown }
      try {
        body = (await response.json()) as { results?: unknown }
      } catch (error) {
        throw new WorkflowError('PROVIDER', 'The search provider sent an unreadable response.', { cause: error })
      }
      const results = Array.isArray(body.results) ? (body.results as TavilyResult[]) : []

      const documents: RetrievedDocument[] = []
      const unavailable: { target: string; reason: string }[] = []
      for (const result of results) {
        const url = asText(result.url)
        const text = asText(result.raw_content) || asText(result.content)
        if (!url) continue
        if (!text) {
          unavailable.push({ target: url, reason: 'no readable text' })
          continue
        }
        const published = asText(result.published_date)
        documents.push({
          url,
          title: asText(result.title) || url,
          sourceType: 'WEB_PAGE',
          publisher: null,
          publishedAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
          retrievedAt: now().toISOString(),
          text,
        })
      }
      return { documents, unavailable }
    },
  }
}
