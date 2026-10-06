// Reveals the seeded "new evidence" on a running `npm run dev:api` server (development only).
const base = process.env.DEV_API_URL ?? 'http://127.0.0.1:8787'
try {
  const response = await fetch(`${base}/dev/advance`, { method: 'POST' })
  console.log(response.ok ? 'new evidence added; the first claim was re-assessed and its change recorded' : `failed: HTTP ${response.status}`)
  process.exitCode = response.ok ? 0 : 1
} catch {
  console.error(`could not reach ${base}; is "npm run dev:api" running?`)
  process.exitCode = 1
}
