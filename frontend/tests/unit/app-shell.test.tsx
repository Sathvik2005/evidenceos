// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../../src/App'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
})

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

describe('application shell', () => {
  it('renders the product, a skip link and landmarks without claiming backend state', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Build evidence')
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })

  it('shows a not-found view for unknown routes', () => {
    renderAt('/nowhere')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy()
  })

  it('toggles the theme and exposes the state to assistive technology', async () => {
    renderAt('/')
    const toggle = screen.getByRole('button', { name: /mode/i })
    const before = toggle.getAttribute('aria-pressed')
    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).not.toBe(before)
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme)
  })
})
