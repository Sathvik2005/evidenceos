import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('.env.example', () => {
  const lines = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))

  it('keeps the admin token server-only and empty', () => {
    expect(lines).toContain('MOMEN_ADMIN_TOKEN=')
    expect(lines.some((line) => /^VITE_.*(TOKEN|SECRET|KEY)/.test(line))).toBe(false)
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
