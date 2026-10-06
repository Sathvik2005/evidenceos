import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../../../database/migrations/', import.meta.url))

/** Applies every migration in order to a fresh in-memory PostgreSQL (PGlite). */
export async function createMigratedDatabase(): Promise<PGlite> {
  const database = new PGlite()
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) await database.exec(await readFile(dir + file, 'utf8'))
  return database
}
