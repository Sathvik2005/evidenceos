import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { conflictingScenario } from '../helpers/fakeBackend'

// The same fixture is asserted by the Python backend tests (backend/tests/test_wire_contract.py), so the
// UI's idea of a record and the API's actual output cannot drift apart unnoticed.
const wire = JSON.parse(readFileSync(new URL('../fixtures/wire.json', import.meta.url), 'utf8')) as Record<string, string[]>
const keys = (record: object) => Object.keys(record).sort()

describe('wire contract', () => {
  const records = conflictingScenario()

  it('UI test data has exactly the record keys the API returns', () => {
    expect(keys(records.investigations[0] ?? {})).toEqual([...(wire.investigation ?? [])].sort())
    expect(keys(records.claims[0] ?? {})).toEqual([...(wire.claim ?? [])].sort())
    expect(keys(records.sources[0] ?? {})).toEqual([...(wire.source ?? [])].sort())
    expect(keys(records.evidence[0] ?? {})).toEqual([...(wire.evidence ?? [])].sort())
    expect(keys(records.changes[0] ?? {})).toEqual([...(wire.change ?? [])].sort())
  })
})
