import { setInvestigationStatus } from '../api/operations'
import { buildInvestigationGraph, runInvestigation, type RunInput } from './graph'
import { createWorkflowHandlers, type WorkflowDeps } from './handlers'
import type { WorkflowOptions, WorkflowSnapshot } from './types'

/**
 * Runs the full investigation workflow. A failed run is persisted as ERROR; partial
 * progress already saved (claims, evidence, history) is kept.
 */
export async function runInvestigationWorkflow(
  deps: WorkflowDeps,
  input: RunInput,
  options: WorkflowOptions = {},
): Promise<WorkflowSnapshot> {
  const graph = buildInvestigationGraph(createWorkflowHandlers(deps), {
    ...(deps.maxRetries === undefined ? {} : { maxRetries: deps.maxRetries }),
    ...options,
  })
  const result = await runInvestigation(graph, input)
  if (result.status === 'FAILED') {
    // Best effort: if even this write fails, the FAILED snapshot is still returned to the caller.
    await setInvestigationStatus(deps.db, input.ownerId, input.investigationId, 'ERROR')
  }
  return result
}
