import { Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph'
import {
  DEFAULT_MAX_RETRIES, TRANSIENT_FAILURES, WORKFLOW_NODES, WorkflowError,
  type NodeHandler, type NodeHandlers, type NodeUpdate, type TraceEntry, type WorkflowFailure,
  type WorkflowNode, type WorkflowOptions, type WorkflowSnapshot,
} from './types'

const append = <T>(left: readonly T[], right: readonly T[]): readonly T[] => [...left, ...right]
const merge = <T>(left: Readonly<Record<string, T>>, right: Readonly<Record<string, T>>) => ({ ...left, ...right })
const replace = <T>(_left: T, right: T): T => right

/** Explicit, serializable workflow state. Maps are merged so per-claim work can fan out later. */
export const InvestigationState = Annotation.Root({
  investigationId: Annotation<string>({ reducer: replace, default: () => '' }),
  ownerId: Annotation<string>({ reducer: replace, default: () => '' }),
  question: Annotation<string>({ reducer: replace, default: () => '' }),
  status: Annotation<WorkflowSnapshot['status']>({ reducer: replace, default: () => 'RUNNING' }),
  claims: Annotation<WorkflowSnapshot['claims']>({ reducer: replace, default: () => [] }),
  evidenceByClaim: Annotation<WorkflowSnapshot['evidenceByClaim']>({ reducer: merge, default: () => ({}) }),
  assessments: Annotation<WorkflowSnapshot['assessments']>({ reducer: merge, default: () => ({}) }),
  outcomes: Annotation<WorkflowSnapshot['outcomes']>({ reducer: merge, default: () => ({}) }),
  ledger: Annotation<WorkflowSnapshot['ledger']>({ reducer: merge, default: () => ({}) }),
  persistedEvidence: Annotation<WorkflowSnapshot['persistedEvidence']>({ reducer: merge, default: () => ({}) }),
  evaluations: Annotation<WorkflowSnapshot['evaluations']>({ reducer: merge, default: () => ({}) }),
  priorEvidenceIds: Annotation<WorkflowSnapshot['priorEvidenceIds']>({ reducer: replace, default: () => [] }),
  summary: Annotation<string | null>({ reducer: replace, default: () => null }),
  trace: Annotation<readonly TraceEntry[]>({ reducer: append, default: () => [] }),
  failures: Annotation<readonly WorkflowFailure[]>({ reducer: append, default: () => [] }),
})

/**
 * Placeholder handlers fabricate nothing: every node is a no-op, so a run that uses them
 * produces no claims, evidence or states.
 */
export const placeholderHandlers: NodeHandlers = Object.freeze(
  Object.fromEntries(
    WORKFLOW_NODES.map((node) => [node, async (): Promise<NodeUpdate> => ({})]),
  ) as unknown as Record<WorkflowNode, NodeHandler>,
)

function wrap(node: WorkflowNode, handler: NodeHandler, options: WorkflowOptions) {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const now = options.now ?? (() => new Date())

  return async (state: WorkflowSnapshot) => {
    const trace: TraceEntry[] = []
    const record = (entry: Pick<TraceEntry, 'attempt' | 'outcome' | 'detail'>) => {
      const full: TraceEntry = { node, at: now().toISOString(), investigationId: state.investigationId, ...entry }
      trace.push(full)
      options.log?.(full)
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        const update = await handler(state)
        record({ attempt, outcome: 'OK' })
        return { ...update, trace }
      } catch (error) {
        const failure =
          error instanceof WorkflowError ? error : new WorkflowError('WORKFLOW', 'Unexpected node failure.', { cause: error })
        const retryable = TRANSIENT_FAILURES.has(failure.kind) && attempt <= maxRetries
        record({ attempt, outcome: retryable ? 'RETRY' : 'FAILED', detail: failure.kind })
        if (!retryable) {
          return {
            status: 'FAILED' as const,
            trace,
            failures: [{ node, kind: failure.kind, message: failure.message }],
          }
        }
      }
    }
  }
}

/** Builds the linear foundation graph; a failed node ends the run with explicit FAILED status. */
export function buildInvestigationGraph(
  handlers: NodeHandlers = placeholderHandlers,
  options: WorkflowOptions = {},
) {
  const graph = new StateGraph(InvestigationState)
  // Node names are a runtime list, so the builder is widened to accept them.
  const loose = graph as unknown as {
    addNode(name: string, fn: ReturnType<typeof wrap>): unknown
    addEdge(from: string, to: string): unknown
    addConditionalEdges(from: string, route: (s: WorkflowSnapshot) => string, ends: string[]): unknown
  }

  for (const node of WORKFLOW_NODES) {
    loose.addNode(node, wrap(node, handlers[node], options))
  }
  loose.addEdge(START, WORKFLOW_NODES[0])
  WORKFLOW_NODES.forEach((node, index) => {
    const next = WORKFLOW_NODES[index + 1]
    loose.addConditionalEdges(node, (state) => (state.status === 'FAILED' || !next ? END : next), [
      ...(next ? [next] : []),
      END,
    ])
  })

  return graph.compile({ checkpointer: new MemorySaver() })
}

export interface RunInput {
  readonly investigationId: string
  readonly ownerId: string
  readonly question: string
}

/** Runs to the end; `threadId` makes the run checkpointable and resumable. */
export async function runInvestigation(
  graph: ReturnType<typeof buildInvestigationGraph>,
  input: RunInput,
  threadId: string = input.investigationId,
): Promise<WorkflowSnapshot> {
  const result = (await graph.invoke(input, { configurable: { thread_id: threadId } })) as WorkflowSnapshot
  if (result.status === 'FAILED') return result
  // COMPLETED only when every node ran and nothing failed; otherwise the run is explicitly PARTIAL.
  const ranAll = WORKFLOW_NODES.every((node) => result.trace.some((t) => t.node === node && t.outcome === 'OK'))
  return { ...result, status: ranAll && result.failures.length === 0 ? 'COMPLETED' : 'PARTIAL' }
}
