import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createInvestigation, setInvestigationStatus } from '../../src/api/operations'
import { createHttpGateway } from '../../src/gateway/httpGateway'
import { handleApiRequest, type ApiDeps } from '../../src/server/http'
import { createMigratedDatabase } from '../helpers/migratedDb'

let pg: PGlite
const started: { id: string; owner: string }[] = []
const DEMO_OWNER = '11111111-1111-4111-8111-111111111111'
let demoId = ''

const deps = (): ApiDeps => ({
  db: pg,
  startWorkflow: (id, owner) => void started.push({ id, owner }),
  demo: { investigationId: demoId, ownerId: DEMO_OWNER },
})

beforeAll(async () => {
  pg = await createMigratedDatabase()
  const demo = await createInvestigation(pg, DEMO_OWNER, { question: 'Public demo question?' })
  if (!demo.ok) throw new Error('setup failed')
  demoId = demo.data.id
})
afterAll(async () => {
  await pg.close()
})

const call = (path: string, init: RequestInit = {}, cookie?: string) =>
  handleApiRequest(
    new Request(`https://evidenceos.example/api${path}`, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string> | undefined) },
    }),
    deps(),
  )

const post = (path: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  call(path, { method: 'POST', body: JSON.stringify(body), headers }, cookie)

function cookieOf(response: Response): string {
  const header = response.headers.get('set-cookie') ?? ''
  return header.split(';')[0] ?? ''
}

describe('HTTP API', () => {
  it('reports health and degrades honestly when the database is down', async () => {
    expect((await call('/health')).status).toBe(200)
    const broken = await handleApiRequest(new Request('https://x.example/api/health'), { ...deps(), db: { query: async () => { throw new Error('connection refused to postgres://user:secret@host') } } })
    expect(broken.status).toBe(503)
    expect(await broken.text()).not.toContain('secret')
  })

  it('creates an investigation, assigns an HttpOnly owner cookie and starts the workflow once', async () => {
    const before = started.length
    const response = await post('/investigations', { question: 'Does remote learning improve student outcomes?', idempotencyKey: 'k-1' })
    expect(response.status).toBe(201)
    const cookie = cookieOf(response)
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax/)
    const { data } = (await response.json()) as { data: { id: string; status: string } }
    expect(started.length).toBe(before + 1)

    const replay = await post('/investigations', { question: 'Does remote learning improve student outcomes?', idempotencyKey: 'k-1' }, cookie)
    expect(replay.status).toBe(201)
    expect(((await replay.json()) as { data: { id: string } }).data.id).toBe(data.id)
    expect(started.length).toBe(before + 1) // no second run for a replayed request
  })

  it('isolates owners: another browser cannot read or refresh someone else’s investigation', async () => {
    const created = await post('/investigations', { question: 'Private question?' })
    const owner = cookieOf(created)
    const { data } = (await created.json()) as { data: { id: string } }
    expect((await call(`/investigations/${data.id}`, {}, owner)).status).toBe(200)
    expect((await call(`/investigations/${data.id}`, {}, 'eos_uid=22222222-2222-4222-8222-222222222222')).status).toBe(404)
    expect((await post(`/investigations/${data.id}/refresh`, {}, 'eos_uid=22222222-2222-4222-8222-222222222222')).status).toBe(404)
    expect((await call(`/investigations/${data.id}/claims`, {}, 'eos_uid=22222222-2222-4222-8222-222222222222')).status).toBe(404)
  })

  it('serves the configured demo investigation read-only to everyone', async () => {
    const stranger = 'eos_uid=33333333-3333-4333-8333-333333333333'
    expect((await call(`/investigations/${demoId}`, {}, stranger)).status).toBe(200)
    expect((await call(`/investigations/${demoId}/claims`, {}, stranger)).status).toBe(200)
    expect((await post(`/investigations/${demoId}/refresh`, {}, stranger)).status).toBe(404)
  })

  it('refreshes only idle investigations and refuses a second concurrent run', async () => {
    const created = await post('/investigations', { question: 'Refresh me?' })
    const cookie = cookieOf(created)
    const { data } = (await created.json()) as { data: { id: string } }
    const owner = cookie.split('=')[1] ?? ''
    // The creation already claimed the run, so a refresh now conflicts.
    expect((await post(`/investigations/${data.id}/refresh`, {}, cookie)).status).toBe(409)

    await setInvestigationStatus(pg, owner, data.id, 'READY')
    const before = started.length
    expect((await post(`/investigations/${data.id}/refresh`, {}, cookie)).status).toBe(202)
    expect(started.length).toBe(before + 1)
    expect((await post(`/investigations/${data.id}/refresh`, {}, cookie)).status).toBe(409)
    expect(started.length).toBe(before + 1)
  })

  it('validates input and rejects abuse with structured errors', async () => {
    const empty = await post('/investigations', { question: '   ' })
    expect(empty.status).toBe(400)
    expect(((await empty.json()) as { error: { field: string } }).error.field).toBe('question')
    expect((await call('/investigations', { method: 'POST', body: '{not json', headers: { 'content-type': 'application/json' } })).status).toBe(400)
    expect((await call('/investigations', { method: 'POST', body: 'question=x', headers: { 'content-type': 'text/plain' } })).status).toBe(400)
    expect((await post('/investigations', { question: 'x'.repeat(20000) })).status).toBe(400)
    expect((await post('/investigations', { question: 'Cross-site?' }, undefined, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await call('/investigations/not-a-uuid')).status).toBe(400)
    expect((await call('/nope')).status).toBe(404)
    expect((await call('/investigations', { method: 'DELETE' })).status).toBe(405)
    expect((await call(`/investigations/${demoId}/claims/extra/segments`)).status).toBe(404)
  })

  it('never leaks internals on unexpected failures', async () => {
    const exploding = await handleApiRequest(
      new Request('https://x.example/api/investigations/11111111-1111-4111-8111-111111111111'),
      { ...deps(), db: { query: async () => { throw new Error('pg: password authentication failed for user "postgres"') } } },
    )
    expect(exploding.status).toBe(500)
    expect(await exploding.text()).not.toMatch(/password|postgres/i)
  })

  it('works end to end through the browser gateway client', async () => {
    let cookie = ''
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await handleApiRequest(
        new Request(`https://evidenceos.example${String(input)}`, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(cookie ? { cookie } : {}) } }),
        deps(),
      )
      cookie = cookieOf(response) || cookie
      return response
    }) as typeof fetch
    const gateway = createHttpGateway('/api', fetchImpl)

    const created = await gateway.createInvestigation({ question: 'Via the gateway?', idempotencyKey: 'gw-1' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect((await gateway.getInvestigation(created.data.id)).ok).toBe(true)
    expect(await gateway.listClaims(created.data.id)).toEqual({ ok: true, data: [] })
    const missing = await gateway.getInvestigation('00000000-0000-4000-8000-000000000000')
    expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })

    const offline = createHttpGateway('/api', (async () => { throw new TypeError('network down') }) as typeof fetch)
    expect(await offline.getInvestigation('x')).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } })
  })
})
