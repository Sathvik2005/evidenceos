// Seeds the demo data into the database named by DATABASE_URL (no model or search keys needed).
//   npm run seed            stage 1: claims, first evidence, first assessments
//   npm run seed -- advance stage 2: new evidence arrives and the first claim changes state
// Data is written through the product's operations and hard rules; see frontend/src/server/seed.ts.
import { readFile } from 'node:fs/promises'
import { listInvestigations } from '../frontend/src/api/operations'
import { createPostgresDatabase } from '../frontend/src/server/adapters/postgres'
import type { RecordedDocument } from '../frontend/src/server/adapters/recorded'
import { seedAdvance, seedInitial } from '../frontend/src/server/seed'

const url = process.env.DATABASE_URL
const owner = process.env.DEMO_OWNER_ID
if (!url || !owner) {
  console.error('DATABASE_URL and DEMO_OWNER_ID must be set.')
  process.exit(2)
}

const db = createPostgresDatabase(url)
try {
  const corpus = (JSON.parse(await readFile(new URL('../demo/corpus.json', import.meta.url), 'utf8')) as { documents: RecordedDocument[] }).documents
  if (process.argv[2] === 'advance') {
    const existing = await listInvestigations(db, owner)
    const id = existing.ok ? existing.data[0]?.id : undefined
    if (!id) throw new Error('No seeded investigation found; run `npm run seed` first.')
    await seedAdvance(db, owner, id, corpus)
    console.log(`advanced ${id}`)
  } else {
    const id = await seedInitial(db, owner, corpus)
    console.log(`seeded ${id}\nSet DEMO_INVESTIGATION_ID=${id} and DEMO_OWNER_ID=${owner} in the deployment environment.`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'seed failed')
  process.exitCode = 1
} finally {
  await db.close()
}
