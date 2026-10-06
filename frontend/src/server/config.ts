// Server configuration from the environment. Names are reported when missing; values never are.
export interface ServerConfig {
  readonly appEnv: 'development' | 'test' | 'demo' | 'production'
  readonly databaseUrl: string
  readonly llm: { readonly apiKey: string; readonly model: string } | null
  readonly research: { readonly provider: 'tavily'; readonly apiKey: string } | null
  readonly demo: { readonly investigationId: string; readonly ownerId: string } | null
}

type Env = Readonly<Record<string, string | undefined>>

const APP_ENVS = ['development', 'test', 'demo', 'production'] as const
export const DEFAULT_LLM_MODEL = 'claude-sonnet-5-5'

export function readServerConfig(env: Env): ServerConfig {
  const appEnv = (env.APPLICATION_ENV ?? env.APP_ENV ?? 'development') as ServerConfig['appEnv']
  if (!APP_ENVS.includes(appEnv)) throw new Error(`APPLICATION_ENV must be one of: ${APP_ENVS.join(', ')}.`)

  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) throw new Error('Missing required environment variable DATABASE_URL.')

  const provider = env.RESEARCH_PROVIDER ?? 'tavily'
  if (provider !== 'tavily') throw new Error('RESEARCH_PROVIDER must be "tavily".')

  const demoId = env.DEMO_INVESTIGATION_ID
  const demoOwner = env.DEMO_OWNER_ID
  if (Boolean(demoId) !== Boolean(demoOwner)) {
    throw new Error('DEMO_INVESTIGATION_ID and DEMO_OWNER_ID must be set together.')
  }

  return {
    appEnv,
    databaseUrl,
    // Providers are optional so reads and the health check work without them; research is then
    // reported as unavailable instead of failing mysteriously.
    llm: env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL || DEFAULT_LLM_MODEL } : null,
    research: env.TAVILY_API_KEY ? { provider: 'tavily', apiKey: env.TAVILY_API_KEY } : null,
    demo: demoId && demoOwner ? { investigationId: demoId, ownerId: demoOwner } : null,
  }
}
