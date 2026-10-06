import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

const schemaPath = fileURLToPath(
  new URL('../../../database/migrations/001_initial_schema.sql', import.meta.url),
)
const schema = readFile(schemaPath, 'utf8')

interface Fixture {
  investigationId: string
  claimId: string
  sourceId: string
  evidenceId: string
}

let database: PGlite

async function insertFixture(question: string): Promise<Fixture> {
  const investigationResult = await database.query<{ id: string }>(
    `INSERT INTO investigations (owner_id, question)
     VALUES ('user-1', $1)
     RETURNING id`,
    [question],
  )
  const investigationId = investigationResult.rows[0]?.id
  if (!investigationId) {
    throw new Error('Test fixture investigation was not created.')
  }

  const claimResult = await database.query<{ id: string }>(
    `INSERT INTO claims (investigation_id, ordinal, statement)
     VALUES ($1, 1, 'The claim under test.')
     RETURNING id`,
    [investigationId],
  )
  const claimId = claimResult.rows[0]?.id
  if (!claimId) {
    throw new Error('Test fixture claim was not created.')
  }

  const sourceResult = await database.query<{ id: string }>(
    `INSERT INTO sources (investigation_id, source_type, url, title)
     VALUES ($1, 'WEB_PAGE', 'https://example.org/source', 'Test source')
     RETURNING id`,
    [investigationId],
  )
  const sourceId = sourceResult.rows[0]?.id
  if (!sourceId) {
    throw new Error('Test fixture source was not created.')
  }

  const evidenceResult = await database.query<{ id: string }>(
    `INSERT INTO evidence (
       investigation_id, claim_id, source_id, relationship, strength, excerpt
     )
     VALUES ($1, $2, $3, 'SUPPORTS', 'STRONG', 'A quoted source excerpt.')
     RETURNING id`,
    [investigationId, claimId, sourceId],
  )
  const evidenceId = evidenceResult.rows[0]?.id
  if (!evidenceId) {
    throw new Error('Test fixture evidence was not created.')
  }

  return { investigationId, claimId, sourceId, evidenceId }
}

beforeAll(async () => {
  database = new PGlite()
  await database.exec(await schema)
})

beforeEach(async () => {
  await database.query('BEGIN')
})

afterEach(async () => {
  await database.query('ROLLBACK')
})

afterAll(async () => {
  await database.close()
})

describe('provisional PostgreSQL data model', () => {
  it('creates related investigation, claim, source, and evidence records', async () => {
    const fixture = await insertFixture('A representative question?')
    const result = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM evidence e
       JOIN claims c
         ON c.investigation_id = e.investigation_id
        AND c.id = e.claim_id
       JOIN sources s
         ON s.investigation_id = e.investigation_id
        AND s.id = e.source_id
       WHERE e.investigation_id = $1
         AND c.id = $2`,
      [fixture.investigationId, fixture.claimId],
    )

    expect(result.rows[0]?.count).toBe(1)
  })

  it('rejects evidence that references a source from another investigation', async () => {
    const first = await insertFixture('First investigation?')
    const second = await insertFixture('Second investigation?')

    await expect(
      database.query(
        `INSERT INTO evidence (
           investigation_id, claim_id, source_id, relationship, strength, excerpt
         )
         VALUES ($1, $2, $3, 'SUPPORTS', 'MODERATE', 'Cross-investigation excerpt.')
         `,
        [first.investigationId, first.claimId, second.sourceId],
      ),
    ).rejects.toThrow()
  })

  it('records a state change only when prior state and triggering evidence match', async () => {
    const fixture = await insertFixture('State transition question?')

    await database.query(
      `INSERT INTO evidence_changes (
         investigation_id, claim_id, previous_state, new_state, reason,
         triggering_evidence_id, idempotency_key
       )
       VALUES ($1, $2, NULL, 'SUPPORTED', 'Supported by validated evidence.',
               $3, 'transition-1')`,
      [fixture.investigationId, fixture.claimId, fixture.evidenceId],
    )

    const state = await database.query<{ state: string }>(
      'SELECT state FROM claims WHERE id = $1',
      [fixture.claimId],
    )
    expect(state.rows[0]?.state).toBe('SUPPORTED')

    await expect(
      database.query(
        `INSERT INTO evidence_changes (
           investigation_id, claim_id, previous_state, new_state, reason,
           triggering_evidence_id, idempotency_key
         )
         VALUES ($1, $2, 'INSUFFICIENT', 'CONFLICTING', 'Mismatched prior state.',
                 $3, 'transition-2')`,
        [fixture.investigationId, fixture.claimId, fixture.evidenceId],
      ),
    ).rejects.toThrow('Claim state does not match the recorded previous state.')
  })

  it('rejects a transition triggered by evidence belonging to another claim', async () => {
    const fixture = await insertFixture('Evidence ownership question?')
    const otherClaim = await database.query<{ id: string }>(
      `INSERT INTO claims (investigation_id, ordinal, statement)
       VALUES ($1, 2, 'A different claim.')
       RETURNING id`,
      [fixture.investigationId],
    )
    const otherClaimId = otherClaim.rows[0]?.id
    if (!otherClaimId) {
      throw new Error('Test fixture second claim was not created.')
    }

    await expect(
      database.query(
        `INSERT INTO evidence_changes (
           investigation_id, claim_id, previous_state, new_state, reason,
           triggering_evidence_id, idempotency_key
         )
         VALUES ($1, $2, NULL, 'SUPPORTED', 'Evidence belongs elsewhere.',
                 $3, 'transition-3')`,
        [fixture.investigationId, otherClaimId, fixture.evidenceId],
      ),
    ).rejects.toThrow()
  })

  it('keeps evidence-change history append-only', async () => {
    const fixture = await insertFixture('Append-only history question?')
    const history = await database.query<{ id: string }>(
      `INSERT INTO evidence_changes (
         investigation_id, claim_id, previous_state, new_state, reason,
         triggering_evidence_id, idempotency_key
       )
       VALUES ($1, $2, NULL, 'SUPPORTED', 'Initial supported state.',
               $3, 'transition-4')
       RETURNING id`,
      [fixture.investigationId, fixture.claimId, fixture.evidenceId],
    )
    const historyId = history.rows[0]?.id
    if (!historyId) {
      throw new Error('Test fixture history record was not created.')
    }

    await database.query('SAVEPOINT update_history_attempt')
    await expect(
      database.query(
        `UPDATE evidence_changes SET reason = 'Rewritten history.' WHERE id = $1`,
        [historyId],
      ),
    ).rejects.toThrow('Evidence change history is append-only.')
    await database.query('ROLLBACK TO SAVEPOINT update_history_attempt')

    await database.query('SAVEPOINT delete_history_attempt')
    await expect(
      database.query('DELETE FROM evidence_changes WHERE id = $1', [historyId]),
    ).rejects.toThrow('Evidence change history is append-only.')
    await database.query('ROLLBACK TO SAVEPOINT delete_history_attempt')
  })
})
