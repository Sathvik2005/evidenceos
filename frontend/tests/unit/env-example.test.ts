import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('.env.example', () => {
  const example = readFileSync(
    new URL('../../../.env.example', import.meta.url),
    'utf8',
  )

  it('keeps the admin token server-only and empty', () => {
    expect(example).toMatch(/^MOMEN_ADMIN_TOKEN=$/m)
    expect(example).not.toMatch(/^VITE_[A-Z0-9_]*(TOKEN|SECRET|KEY)=/m)
  })

  it('keeps the endpoint diagnostic anonymous-only', () => {
    const diagnostic = readFileSync(
      new URL('../../../scripts/check-momen.mjs', import.meta.url),
      'utf8',
    )

    expect(diagnostic).not.toMatch(/process\.env\.MOMEN_ADMIN_TOKEN/)
    expect(diagnostic).not.toMatch(/authorization\s*:/i)
  })
})
