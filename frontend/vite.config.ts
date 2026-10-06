import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  envDir: '..',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Each database test boots an in-memory PostgreSQL (WASM); allow for slow starts under load.
    // Worker threads: the forked-process pool crashes natively with the PGlite WASM runtime on Windows.
    pool: 'threads',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
