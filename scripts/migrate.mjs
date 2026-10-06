// Applies database/migrations/*.sql in order and records them. Usage: npm run db:migrate
// Reads DATABASE_URL from the environment; it never prints it.
import { readdir, readFile } from 'node:fs/promises'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(2)
}

const dir = new URL('../database/migrations/', import.meta.url)
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  let count = 0
  for (const file of files) {
    if (applied.has(file)) continue
    await client.query(await readFile(new URL(file, dir), 'utf8'))
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
    console.log(`applied ${file}`)
    count += 1
  }
  console.log(count === 0 ? 'database is up to date' : `applied ${count} migration(s)`)
} catch (error) {
  console.error(`migration failed: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`)
  process.exitCode = 1
} finally {
  await client.end()
}
