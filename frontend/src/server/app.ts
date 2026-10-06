// Composition root for the server: wires configuration, adapters, the workflow and the HTTP API.
import { setInvestigationStatus, type Database } from '../api/operations'
import { runInvestigationWorkflow } from '../workflow/run'
import { createAnthropicLlm } from './adapters/anthropic'
import { createPostgresDatabase } from './adapters/postgres'
import { createTavilySearch } from './adapters/tavily'
import { readServerConfig, type ServerConfig } from './config'
import { handleApiRequest } from './http'

export interface App {
  readonly config: ServerConfig
  handle(request: Request): Promise<Response>
}

type Env = Readonly<Record<string, string | undefined>>

/** One structured line per event; never contains request bodies, source text or credentials. */
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }))

export function createApp(
  env: Env,
  waitUntil: (work: Promise<unknown>) => void,
  overrides: { db?: Database } = {},
): App {
  const config = readServerConfig(env)
  const db = overrides.db ?? createPostgresDatabase(config.databaseUrl)
  const llm = config.llm ? createAnthropicLlm(config.llm) : null
  const search = config.research ? createTavilySearch({ apiKey: config.research.apiKey }) : null

  async function runWorkflow(investigationId: string, ownerId: string): Promise<void> {
    if (!llm || !search) return
    try {
      await runInvestigationWorkflow(
        { db, llm, search },
        { investigationId, ownerId, question: '' },
        { log: (entry) => log({ evt: 'workflow', ...entry }) },
      )
    } catch {
      log({ evt: 'workflow-crash', investigationId })
      await setInvestigationStatus(db, ownerId, investigationId, 'ERROR')
    }
  }

  return {
    config,
    handle: (request) =>
      handleApiRequest(request, {
        db,
        startWorkflow: (investigationId, ownerId) => waitUntil(runWorkflow(investigationId, ownerId)),
        researchAvailable: Boolean(llm && search),
        secureCookies: config.appEnv === 'production',
        ...(config.demo ? { demo: config.demo } : {}),
        log,
      }),
  }
}

let cached: App | undefined

/** Reuses one app (and its connection pool) across invocations of a warm function. */
export function getApp(env: Env, waitUntil: (work: Promise<unknown>) => void): App {
  cached ??= createApp(env, waitUntil)
  return cached
}
