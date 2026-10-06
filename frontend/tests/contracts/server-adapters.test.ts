import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { researchClaim } from '../../src/agents/researchAgent'
import { classifyProviderError, parseModelJson } from '../../src/server/adapters/anthropic'
import { createTavilySearch } from '../../src/server/adapters/tavily'
import { createApp } from '../../src/server/app'
import { readServerConfig } from '../../src/server/config'
import { WorkflowError } from '../../src/workflow/types'
import { scriptedLlm } from '../helpers/scriptedLlm'
import { createMigratedDatabase } from '../helpers/migratedDb'

describe('model reply parsing', () => {
  it('extracts JSON from plain, fenced and prose-wrapped replies', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseModelJson('Here you go: {"a":1} Hope that helps.')).toEqual({ a: 1 })
  })

  it('reports malformed output as a retryable MALFORMED_OUTPUT failure', () => {
    expect(() => parseModelJson('no json here')).toThrowError(WorkflowError)
    try {
      parseModelJson('{broken')
    } catch (error) {
      expect(error).toMatchObject({ kind: 'MALFORMED_OUTPUT' })
    }
  })

  it('classifies provider failures without trusting their messages', () => {
    const headers = new Headers()
    expect(classifyProviderError(Anthropic.APIError.generate(401, {}, 'bad key', headers))).toBe('AUTHENTICATION')
    expect(classifyProviderError(Anthropic.APIError.generate(429, {}, 'slow', headers))).toBe('RATE_LIMIT')
    expect(classifyProviderError(Anthropic.APIError.generate(503, {}, 'down', headers))).toBe('PROVIDER')
    expect(classifyProviderError(new Error('unknown'))).toBe('WORKFLOW')
  })
})

describe('Tavily retrieval adapter', () => {
  const fixed = () => new Date('2026-01-01T00:00:00.000Z')
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch

  it('returns only provider-supplied provenance and flags unreadable results', async () => {
    const search = createTavilySearch({
      apiKey: 'k', now: fixed,
      fetchImpl: respond(200, { results: [
        { url: 'https://example.org/a', title: 'A study', content: 'short', raw_content: 'Full text of the study.', published_date: '2022-05-01' },
        { url: 'https://example.org/b', title: 'Empty', content: '' },
        { title: 'No url', content: 'ignored' },
      ] }),
    })
    const outcome = await search.search('claim')
    expect(outcome.documents).toEqual([{
      url: 'https://example.org/a', title: 'A study', sourceType: 'WEB_PAGE', publisher: null,
      publishedAt: '2022-05-01T00:00:00.000Z', retrievedAt: '2026-01-01T00:00:00.000Z', text: 'Full text of the study.',
    }])
    expect(outcome.unavailable).toEqual([{ target: 'https://example.org/b', reason: 'no readable text' }])
  })

  it('maps HTTP and network failures to retryable or fatal kinds', async () => {
    await expect(createTavilySearch({ apiKey: 'k', fetchImpl: respond(401, {}) }).search('q')).rejects.toMatchObject({ kind: 'AUTHENTICATION' })
    await expect(createTavilySearch({ apiKey: 'k', fetchImpl: respond(429, {}) }).search('q')).rejects.toMatchObject({ kind: 'RATE_LIMIT' })
    await expect(createTavilySearch({ apiKey: 'k', fetchImpl: respond(502, {}) }).search('q')).rejects.toMatchObject({ kind: 'PROVIDER' })
    const offline = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
    await expect(createTavilySearch({ apiKey: 'k', fetchImpl: offline }).search('q')).rejects.toMatchObject({ kind: 'NETWORK' })
  })

  it('feeds the research agent so a fabricated quote is still rejected', async () => {
    const search = createTavilySearch({ apiKey: 'k', fetchImpl: respond(200, { results: [{ url: 'https://example.org/a', title: 'A', content: 'Real sentence in the source.' }] }), now: fixed })
    const llm = scriptedLlm({ candidates: [{ documentIndex: 0, excerpt: 'Invented sentence.', relationship: 'SUPPORTS', strength: 'STRONG' }] })
    await expect(researchClaim({ llm, search }, { id: 'c', statement: 'claim' }, { maxRetries: 0 })).rejects.toMatchObject({ kind: 'MALFORMED_OUTPUT' })
  })

  it('never sends the key anywhere except the Authorization header', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const capture = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ results: [] })) }) as unknown as typeof fetch
    await createTavilySearch({ apiKey: 'SECRET-KEY', fetchImpl: capture }).search('claim text')
    expect(seen?.url).toBe('https://api.tavily.com/search')
    expect(String(seen?.init.body)).not.toContain('SECRET-KEY')
    expect((seen?.init.headers as Record<string, string>).authorization).toBe('Bearer SECRET-KEY')
  })
})

describe('server configuration and composition', () => {
  it('requires DATABASE_URL, names missing variables and never echoes values', () => {
    expect(() => readServerConfig({})).toThrow('DATABASE_URL')
    expect(() => readServerConfig({ DATABASE_URL: 'postgres://u:topsecret@h/db', APPLICATION_ENV: 'nope' })).toThrow(/APPLICATION_ENV/)
    try {
      readServerConfig({ DATABASE_URL: 'postgres://u:topsecret@h/db', APPLICATION_ENV: 'nope' })
    } catch (error) {
      expect(String(error)).not.toContain('topsecret')
    }
    expect(() => readServerConfig({ DATABASE_URL: 'x', DEMO_INVESTIGATION_ID: 'only-one' })).toThrow(/together/)
  })

  it('treats missing provider keys as "research unavailable" rather than crashing', async () => {
    const db = await createMigratedDatabase()
    const app = createApp({ DATABASE_URL: 'postgres://unused' }, () => undefined, { db })
    expect(app.config.llm).toBeNull()
    expect((await app.handle(new Request('https://x.example/api/health'))).status).toBe(200)
    const created = await app.handle(new Request('https://x.example/api/investigations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Anything?' }),
    }))
    expect(created.status).toBe(503)
    expect(await created.text()).toContain('not configured')
    await db.close()
  })
})
