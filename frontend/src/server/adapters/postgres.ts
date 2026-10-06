import pg from 'pg'
import type { Database } from '../../api/operations'

/** PostgreSQL over a small pool. The connection string is read by the caller from the environment. */
export function createPostgresDatabase(connectionString: string): Database & { close(): Promise<void> } {
  const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 })
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const result = await pool.query(sql, params)
      return { rows: result.rows as T[] }
    },
    close: () => pool.end(),
  }
}
