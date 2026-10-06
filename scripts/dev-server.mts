// Local, no-keys development server: the real HTTP API over a file-backed PostgreSQL (PGlite) that is
// seeded with the demo data. Research is reported as unavailable (no provider keys), reads work.
//   npm run dev:api            then, in another terminal:  npm run dev --workspace=@evidenceos/frontend
//   POST /dev/advance          reveals the seeded "new evidence" (development only, 127.0.0.1 only)
// To start over, stop the server and delete the `.data/` folder.
import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listInvestigations } from '../frontend/src/api/operations'
import type { RecordedDocument } from '../frontend/src/server/adapters/recorded'
import { handleApiRequest } from '../frontend/src/server/http'
import { seedAdvance, seedInitial } from '../frontend/src/server/seed'

const root = fileURLToPath(new URL('..', import.meta.url))
const OWNER = 'seed-owner'
const PORT = Number(process.env.PORT ?? 8787)

await mkdir(join(root, '.data'), { recursive: true })
const db = new PGlite(join(root, '.data', 'evidenceos'))
await db.waitReady

const migrations = (await readdir(join(root, 'database', 'migrations'))).filter((f) => f.endsWith('.sql')).sort()
const exists = await db.query<{ present: boolean }>("SELECT to_regclass('public.investigations') IS NOT NULL AS present")
if (!exists.rows[0]?.present) {
  for (const file of migrations) await db.exec(await readFile(join(root, 'database', 'migrations', file), 'utf8'))
  console.log(`applied ${migrations.length} migration(s)`)
}

const corpus = (JSON.parse(await readFile(join(root, 'demo', 'corpus.json'), 'utf8')) as { documents: RecordedDocument[] }).documents
const seeded = await listInvestigations(db, OWNER)
const investigationId = seeded.ok && seeded.data[0] ? seeded.data[0].id : await seedInitial(db, OWNER, corpus)
console.log(`demo investigation ${investigationId}`)

const demo = { investigationId, ownerId: OWNER }
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  try {
    if (url.pathname === '/dev/advance' && req.method === 'POST') {
      await seedAdvance(db, OWNER, investigationId, corpus)
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":{"advanced":true}}')
      return
    }
    const body = req.method === 'POST' ? await new Promise<string>((done) => { let text = ''; req.on('data', (c) => (text += c)); req.on('end', () => done(text)) }) : undefined
    const response = await handleApiRequest(
      new Request(url, { method: req.method, headers: req.headers as Record<string, string>, ...(body === undefined ? {} : { body }) }),
      { db, demo, researchAvailable: false, startWorkflow: () => undefined, log: (e) => console.log(JSON.stringify(e)) },
    )
    const headers: Record<string, string | string[]> = {}
    response.headers.forEach((value, key) => { headers[key] = value })
    res.writeHead(response.status, headers).end(await response.text())
  } catch {
    res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":{"code":"INTERNAL_ERROR","message":"The operation could not be completed."}}')
  }
})
server.listen(PORT, '127.0.0.1', () => console.log(`EvidenceOS dev API on http://127.0.0.1:${PORT}  (research disabled: no provider keys)`))
