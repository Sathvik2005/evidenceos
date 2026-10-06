import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A string path (not a URL object) so this also works under the jsdom test environment.
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../database/migrations')

/** Applies every migration in order to a fresh in-memory PostgreSQL (PGlite). */
export async function createMigratedDatabase(): Promise<PGlite> {
  const database = new PGlite()
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) await database.exec(await readFile(join(dir, file), 'utf8'))
  return database
}
