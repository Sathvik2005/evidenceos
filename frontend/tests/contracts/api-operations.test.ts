import type { PGlite } from '@electric-sql/pglite'
import { createMigratedDatabase } from '../helpers/migratedDb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiResult } from '../../src/api/contracts'
import {
  addClaim, addEvidence, addSource, createInvestigation, getInvestigation, listClaims,
  listEvidenceChanges, listInvestigations, recordClaimAssessment, recordStateChange, type Database,
} from '../../src/api/operations'

let pg: PGlite
let db: Database

beforeAll(async () => {
  pg = await createMigratedDatabase()
  db = pg
})

afterAll(async () => {
  await pg.close()
})

function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.data
}

function errorOf<T>(result: ApiResult<T>) {
  if (result.ok) throw new Error('Expected an error result.')
  return result.error
}

async function seed(owner: string) {
  const investigation = unwrap(await createInvestigation(db, owner, { question: 'Does X hold?' }))
  const claim = unwrap(await addClaim(db, owner, { investigationId: investigation.id, ordinal: 1, statement: 'X holds.' }))
  const source = unwrap(await addSource(db, owner, {
    investigationId: investigation.id, sourceType: 'JOURNAL_ARTICLE', url: 'https://example.org/a', title: 'A study',
  }))
  const evidence = unwrap(await addEvidence(db, owner, {
    investigationId: investigation.id, claimId: claim.id, sourceId: source.id,
    relationship: 'SUPPORTS', strength: 'MODERATE', excerpt: 'A quoted excerpt.',
  }))
  return { investigation, claim, source, evidence }
}

/** Gives the claim its first, directly stored state (a first assessment is not a change event). */
async function assessFirst(owner: string, seeded: Awaited<ReturnType<typeof seed>>, state = 'PARTIALLY_SUPPORTED') {
  return unwrap(await recordClaimAssessment(db, owner, {
    investigationId: seeded.investigation.id, claimId: seeded.claim.id, confidence: 'MEDIUM', reason: 'First assessment.', initialState: state,
  }))
}

describe('API operations: valid requests', () => {
  it('creates and reads related records', async () => {
    const { investigation, claim, evidence } = await seed('owner-valid')
    expect(unwrap(await getInvestigation(db, 'owner-valid', investigation.id)).question).toBe('Does X hold?')
    expect(unwrap(await listClaims(db, 'owner-valid', investigation.id))).toEqual([claim])
    expect(evidence.claimId).toBe(claim.id)
    expect(claim.state).toBeNull()
  })

  it('records a state change and updates the claim', async () => {
    const seeded = await seed('owner-change')
    const { investigation, claim, evidence } = seeded
    expect((await assessFirst('owner-change', seeded)).state).toBe('PARTIALLY_SUPPORTED')
    const change = unwrap(await recordStateChange(db, 'owner-change', {
      investigationId: investigation.id, claimId: claim.id, previousState: 'PARTIALLY_SUPPORTED', newState: 'CONFLICTING',
      reason: 'New contradicting evidence.', triggeringEvidenceId: evidence.id, idempotencyKey: 'k1',
    }))
    expect(change.newState).toBe('CONFLICTING')
    expect(unwrap(await listClaims(db, 'owner-change', investigation.id))[0]?.state).toBe('CONFLICTING')
    expect(unwrap(await listEvidenceChanges(db, 'owner-change', investigation.id))).toHaveLength(1)
  })

  it('bounds pagination', async () => {
    await createInvestigation(db, 'owner-page', { question: 'One?' })
    await createInvestigation(db, 'owner-page', { question: 'Two?' })
    expect(unwrap(await listInvestigations(db, 'owner-page', { limit: 1 }))).toHaveLength(1)
    expect(errorOf(await listInvestigations(db, 'owner-page', { limit: 101 })).code).toBe('VALIDATION_FAILED')
    expect(errorOf(await listInvestigations(db, 'owner-page', { offset: -1 })).field).toBe('offset')
  })
})

describe('API operations: invalid requests', () => {
  it('rejects malformed input with the offending field', async () => {
    expect(errorOf(await createInvestigation(db, 'o', { question: '   ' })).field).toBe('question')
    const { investigation, claim, source } = await seed('owner-invalid')
    const base = { investigationId: investigation.id, claimId: claim.id, sourceId: source.id }
    expect(errorOf(await addEvidence(db, 'owner-invalid', {
      ...base, relationship: 'MAYBE' as never, strength: 'STRONG', excerpt: 'x',
    })).field).toBe('relationship')
    expect(errorOf(await addEvidence(db, 'owner-invalid', {
      ...base, relationship: 'SUPPORTS', strength: 'STRONG', excerpt: '',
    })).field).toBe('excerpt')
    expect(errorOf(await addSource(db, 'owner-invalid', {
      investigationId: investigation.id, sourceType: 'WEB_PAGE', url: 'ftp://example.org', title: 't',
    })).field).toBe('url')
    expect(errorOf(await addClaim(db, 'owner-invalid', {
      investigationId: 'not-a-uuid', ordinal: 2, statement: 's',
    })).field).toBe('investigationId')
    expect(errorOf(await addClaim(db, 'owner-invalid', {
      investigationId: investigation.id, ordinal: 0, statement: 's',
    })).field).toBe('ordinal')
  })

  it('rejects evidence referencing a source from another investigation', async () => {
    const a = await seed('owner-ref-a')
    const b = await seed('owner-ref-a')
    const error = errorOf(await addEvidence(db, 'owner-ref-a', {
      investigationId: a.investigation.id, claimId: a.claim.id, sourceId: b.source.id,
      relationship: 'CONTRADICTS', strength: 'WEAK', excerpt: 'Cross-investigation excerpt.',
    }))
    expect(error.code).toBe('REFERENCE_INVALID')
    expect(error.message).not.toMatch(/violates|constraint|evidence_/i)
  })

  it('rejects a state change with a stale previous state or foreign evidence', async () => {
    const a = await seed('owner-state')
    const b = await seed('owner-state')
    await assessFirst('owner-state', a)
    const stale = errorOf(await recordStateChange(db, 'owner-state', {
      investigationId: a.investigation.id, claimId: a.claim.id, previousState: 'SUPPORTED', newState: 'CONFLICTING',
      reason: 'Stale.', triggeringEvidenceId: a.evidence.id, idempotencyKey: 'stale',
    }))
    expect(stale.code).toBe('CONSTRAINT_VIOLATION')
    const foreign = errorOf(await recordStateChange(db, 'owner-state', {
      investigationId: a.investigation.id, claimId: a.claim.id, previousState: 'PARTIALLY_SUPPORTED', newState: 'CONFLICTING',
      reason: 'Wrong evidence.', triggeringEvidenceId: b.evidence.id, idempotencyKey: 'foreign',
    }))
    expect(foreign.code).toBe('REFERENCE_INVALID')
    expect(unwrap(await listClaims(db, 'owner-state', a.investigation.id))[0]?.state).toBe('PARTIALLY_SUPPORTED')
    expect(errorOf(await recordStateChange(db, 'owner-state', {
      investigationId: a.investigation.id, claimId: a.claim.id, previousState: 'PARTIALLY_SUPPORTED', newState: 'PARTIALLY_SUPPORTED',
      reason: 'No-op.', triggeringEvidenceId: a.evidence.id, idempotencyKey: 'noop',
    })).field).toBe('newState')
  })
})

describe('API operations: ownership', () => {
  it('hides other owners’ investigations and blocks writes to them', async () => {
    const { investigation } = await seed('owner-one')
    expect(errorOf(await getInvestigation(db, 'owner-two', investigation.id)).code).toBe('NOT_FOUND')
    expect(errorOf(await addClaim(db, 'owner-two', {
      investigationId: investigation.id, ordinal: 2, statement: 'Intrusion.',
    })).code).toBe('NOT_FOUND')
    expect(errorOf(await listClaims(db, 'owner-two', investigation.id)).code).toBe('NOT_FOUND')
    expect(unwrap(await listInvestigations(db, 'owner-two'))).toHaveLength(0)
  })
})

describe('API operations: idempotency', () => {
  it('returns the same record for an identical replay without duplicating', async () => {
    const first = unwrap(await createInvestigation(db, 'owner-idem', { question: 'Replay?', idempotencyKey: 'inv-1' }))
    const second = unwrap(await createInvestigation(db, 'owner-idem', { question: 'Replay?', idempotencyKey: 'inv-1' }))
    expect(second.id).toBe(first.id)
    expect(unwrap(await listInvestigations(db, 'owner-idem'))).toHaveLength(1)

    const claimInput = { investigationId: first.id, ordinal: 1, statement: 'Once.', idempotencyKey: 'claim-1' }
    const claim = unwrap(await addClaim(db, 'owner-idem', claimInput))
    expect(unwrap(await addClaim(db, 'owner-idem', claimInput)).id).toBe(claim.id)
    expect(unwrap(await listClaims(db, 'owner-idem', first.id))).toHaveLength(1)
  })

  it('rejects a key reused with different content', async () => {
    unwrap(await createInvestigation(db, 'owner-idem2', { question: 'Original?', idempotencyKey: 'k' }))
    expect(errorOf(await createInvestigation(db, 'owner-idem2', { question: 'Different?', idempotencyKey: 'k' })).code)
      .toBe('IDEMPOTENCY_CONFLICT')
  })

  it('does not duplicate state changes on retry', async () => {
    const seeded = await seed('owner-idem3')
    const { investigation, claim, evidence } = seeded
    await assessFirst('owner-idem3', seeded)
    const input = {
      investigationId: investigation.id, claimId: claim.id, previousState: 'PARTIALLY_SUPPORTED' as const, newState: 'CONFLICTING' as const,
      reason: 'Assessed.', triggeringEvidenceId: evidence.id, idempotencyKey: 'change-1',
    }
    const first = unwrap(await recordStateChange(db, 'owner-idem3', input))
    expect(unwrap(await recordStateChange(db, 'owner-idem3', input)).id).toBe(first.id)
    expect(unwrap(await listEvidenceChanges(db, 'owner-idem3', investigation.id))).toHaveLength(1)
  })
})
