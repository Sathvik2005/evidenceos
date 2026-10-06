// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLAIM_STATES } from '../../src/api/contracts'
import { StateBadge } from '../../src/components/StateBadge'
import { EmptyState, ErrorState, LoadingState, PartialNotice } from '../../src/components/StatusViews'

afterEach(cleanup)

describe('status primitives', () => {
  it('announces loading politely without a percentage', () => {
    render(<LoadingState label="Loading claims" />)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Loading claims')
    expect(status.textContent).not.toMatch(/%/)
  })

  it('renders empty and partial states with text', () => {
    render(
      <>
        <EmptyState title="Nothing here">No claims yet.</EmptyState>
        <PartialNotice title="Incomplete">2 claims unresolved.</PartialNotice>
      </>,
    )
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeTruthy()
    expect(screen.getByRole('note').textContent).toContain('2 claims unresolved')
  })

  it('offers retry only when a handler is given', async () => {
    const retry = vi.fn()
    const { rerender } = render(<ErrorState title="Failed" message="Boom" onRetry={retry} />)
    expect(screen.getByRole('alert').textContent).toContain('Boom')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<ErrorState title="Failed" message="Boom" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('StateBadge', () => {
  it('labels every state in words, not color alone', () => {
    for (const state of CLAIM_STATES) {
      const { container, unmount } = render(<StateBadge state={state} />)
      expect(container.textContent?.replace(/^\S\s/, '').length).toBeGreaterThan(5)
      unmount()
    }
  })

  it('shows an unassessed claim as such, never as a default state', () => {
    render(<StateBadge state={null} />)
    expect(screen.getByText(/not yet assessed/i)).toBeTruthy()
  })
})
