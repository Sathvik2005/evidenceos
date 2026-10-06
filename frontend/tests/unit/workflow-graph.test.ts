import { describe, expect, it } from 'vitest'
import { buildInvestigationGraph, placeholderHandlers, runInvestigation } from '../../src/workflow/graph'
import { WORKFLOW_NODES, WorkflowError, type NodeHandlers, type TraceEntry } from '../../src/workflow/types'

const input = { investigationId: 'inv-1', ownerId: 'owner-1', question: 'Does X hold?' }
const fixedNow = () => new Date('2026-01-01T00:00:00.000Z')

function handlersWith(overrides: Partial<NodeHandlers>): NodeHandlers {
  return { ...placeholderHandlers, ...overrides }
}

describe('workflow foundation graph', () => {
  it('runs every node in order and fabricates nothing with placeholder handlers', async () => {
    const logged: TraceEntry[] = []
    const graph = buildInvestigationGraph(placeholderHandlers, { now: fixedNow, log: (e) => logged.push(e) })
    const result = await runInvestigation(graph, input)

    expect(result.trace.map((t) => t.node)).toEqual([...WORKFLOW_NODES])
    expect(logged).toHaveLength(WORKFLOW_NODES.length)
    expect(result.claims).toEqual([])
    expect(result.evidenceByClaim).toEqual({})
    expect(result.outcomes).toEqual({})
    expect(result.status).toBe('COMPLETED')
  })

  it('retries transient failures within the bound and then succeeds', async () => {
    let calls = 0
    const graph = buildInvestigationGraph(
      handlersWith({
        research: async () => {
          calls += 1
          if (calls < 3) throw new WorkflowError('TIMEOUT', 'slow')
          return {}
        },
      }),
      { now: fixedNow },
    )
    const result = await runInvestigation(graph, input)
    const attempts = result.trace.filter((t) => t.node === 'research')
    expect(attempts.map((t) => t.outcome)).toEqual(['RETRY', 'RETRY', 'OK'])
    expect(result.status).toBe('COMPLETED')
  })

  it('stops after the retry bound and records an explicit FAILED run', async () => {
    let calls = 0
    const graph = buildInvestigationGraph(
      handlersWith({
        research: async () => {
          calls += 1
          throw new WorkflowError('PROVIDER', 'down')
        },
      }),
      { now: fixedNow },
    )
    const result = await runInvestigation(graph, input)
    expect(calls).toBe(3)
    expect(result.status).toBe('FAILED')
    expect(result.failures).toEqual([{ node: 'research', kind: 'PROVIDER', message: 'down' }])
    expect(result.trace.some((t) => t.node === 'analyze')).toBe(false)
  })

  it('never retries deterministic validation failures', async () => {
    let calls = 0
    const graph = buildInvestigationGraph(
      handlersWith({
        validateClaims: async () => {
          calls += 1
          throw new WorkflowError('VALIDATION', 'bad claim')
        },
      }),
    )
    const result = await runInvestigation(graph, input)
    expect(calls).toBe(1)
    expect(result.status).toBe('FAILED')
  })

  it('classifies unexpected exceptions as workflow failures without leaking their message', async () => {
    const graph = buildInvestigationGraph(
      handlersWith({
        load: async () => {
          throw new Error('secret-ish internal detail')
        },
      }),
    )
    const result = await runInvestigation(graph, input)
    expect(result.failures[0]).toMatchObject({ node: 'load', kind: 'WORKFLOW' })
    expect(JSON.stringify(result.failures)).not.toContain('secret-ish')
  })
})
