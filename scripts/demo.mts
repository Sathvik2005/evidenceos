// Demo driver: real workflow runs over recorded, verified source documents (demo/corpus.json).
//   npm run demo:seed      creates the demo investigation and runs the first research pass
//   npm run demo:advance   makes the recorded NEW evidence available and re-runs the workflow
// Nothing is edited by hand: every state, evidence row and history entry is produced by the product.
import { readFile } from 'node:fs/promises'
import { createInvestigation, getInvestigation, listClaims, listEvidenceChanges } from '../frontend/src/api/operations'
import { createAnthropicLlm } from '../frontend/src/server/adapters/anthropic'
import { createPostgresDatabase } from '../frontend/src/server/adapters/postgres'
import { createRecordedSearch, type RecordedDocument } from '../frontend/src/server/adapters/recorded'
import { DEFAULT_LLM_MODEL } from '../frontend/src/server/config'
import { runInvestigationWorkflow } from '../frontend/src/workflow/run'

const QUESTION = 'Does remote learning improve student outcomes?'
const command = process.argv[2]

function need(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required environment variable ${name}.`)
    process.exit(2)
  }
  return value
}

const db = createPostgresDatabase(need('DATABASE_URL'))
const llm = createAnthropicLlm({ apiKey: need('ANTHROPIC_API_KEY'), model: process.env.LLM_MODEL || DEFAULT_LLM_MODEL })
const owner = need('DEMO_OWNER_ID')
const corpus = JSON.parse(await readFile(new URL('../demo/corpus.json', import.meta.url), 'utf8')) as { documents: RecordedDocument[] }

async function run(investigationId: string, phase: number) {
  const result = await runInvestigationWorkflow(
    { db, llm, search: createRecordedSearch(corpus.documents, phase) },
    { investigationId, ownerId: owner, question: '' },
    { log: (entry) => console.log(`  ${entry.node} (${entry.outcome})`) },
  )
  console.log(`run status: ${result.status}${result.failures.length > 0 ? `, ${result.failures.length} failure(s)` : ''}`)
  for (const failure of result.failures) console.log(`  - [${failure.node}] ${failure.kind}: ${failure.message}`)
  const claims = await listClaims(db, owner, investigationId)
  if (claims.ok) for (const claim of claims.data) console.log(`  claim ${claim.ordinal}: ${claim.state ?? 'not assessed'} (${claim.confidence ?? '-'}) ${claim.statement}`)
  return result
}

try {
  if (command === 'seed') {
    const created = await createInvestigation(db, owner, { question: QUESTION, idempotencyKey: 'demo-v1' })
    if (!created.ok) throw new Error(created.error.message)
    console.log(`demo investigation ${created.data.id}`)
    await run(created.data.id, 1)
    console.log(`\nSet DEMO_INVESTIGATION_ID=${created.data.id} (and DEMO_OWNER_ID) in the deployment environment.`)
  } else if (command === 'advance') {
    const id = need('DEMO_INVESTIGATION_ID')
    const existing = await getInvestigation(db, owner, id)
    if (!existing.ok) throw new Error(existing.error.message)
    await run(id, 2)
    const changes = await listEvidenceChanges(db, owner, id)
    if (changes.ok && changes.data.length > 0) {
      for (const change of changes.data) console.log(`  change: ${change.previousState} -> ${change.newState}`)
    } else {
      console.log('  no state change was recorded (the model did not change any claim state this time)')
    }
  } else {
    console.error('Usage: demo.ts seed | advance')
    process.exitCode = 2
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'demo command failed')
  process.exitCode = 1
} finally {
  await db.close()
}
