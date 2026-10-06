// Recorded retrieval for the demo: replays documents that were genuinely fetched and verified
// earlier. It is a SearchProvider like any other, so every downstream integrity check still runs.
import type { RetrievedDocument, SearchOutcome, SearchProvider } from '../../agents/researchAgent'

export interface RecordedDocument extends RetrievedDocument {
  /** The demo step at which this document becomes available (1 = initial, 2 = new evidence). */
  readonly phase: number
}

export function createRecordedSearch(documents: readonly RecordedDocument[], phase: number): SearchProvider {
  return {
    async search(): Promise<SearchOutcome> {
      const available = documents.filter((d) => d.phase <= phase)
      return { documents: available.map((d) => ({ url: d.url, title: d.title, sourceType: d.sourceType, publisher: d.publisher, publishedAt: d.publishedAt, retrievedAt: d.retrievedAt, text: d.text })) }
    },
  }
}
