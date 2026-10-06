// Pushes the server-side variables from .env.local to the linked Vercel project (production).
// Prints variable NAMES only, never values. Empty values are skipped. Usage: npm run vercel:env
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const NAMES = ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'TAVILY_API_KEY', 'LLM_MODEL', 'DEMO_INVESTIGATION_ID', 'DEMO_OWNER_ID']
const target = process.argv[2] ?? 'production'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line)
  if (match) env[match[1]] = match[2]
}
env.APPLICATION_ENV = target === 'production' ? 'production' : 'development'

const pushed = []
const skipped = []
for (const name of [...NAMES, 'APPLICATION_ENV']) {
  const value = env[name]
  if (!value) {
    skipped.push(name)
    continue
  }
  const result = spawnSync('vercel', ['env', 'add', name, target, '--force'], { input: value, encoding: 'utf8', shell: true })
  if (result.status === 0) pushed.push(name)
  else {
    console.error(`failed to set ${name}`)
    process.exitCode = 1
  }
}
console.log(`set on ${target}: ${pushed.join(', ') || 'none'}`)
if (skipped.length > 0) console.log(`skipped (empty locally): ${skipped.join(', ')}`)
