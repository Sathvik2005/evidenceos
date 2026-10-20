// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../../src/App'
import { GatewayProvider } from '../../src/gateway/GatewayProvider'
import { FakeBackend, INV, QUESTION } from '../helpers/fakeBackend'

afterEach(cleanup)

const AT = '2026-10-20T00:00:00.000Z'

const renderAt = (path: string, backend: FakeBackend) =>
  render(<GatewayProvider gateway={backend}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></GatewayProvider>)

const failedRun = (failureKind: string | null) =>
  new FakeBackend({ investigations: [{ id: INV, question: QUESTION, status: 'ERROR', createdAt: AT, updatedAt: AT, failureKind }] })

describe('why a run stopped', () => {
  it('tells the user the recorded reason instead of a bare error', async () => {
    renderAt(`/investigations/${INV}`, failedRun('RATE_LIMIT'))
    await waitFor(() => expect(screen.getByText(/rate-limiting this server or its quota is used up/)).toBeTruthy())
  })

  it('says plainly when no reason was recorded rather than guessing one', async () => {
    renderAt(`/investigations/${INV}`, failedRun(null))
    await waitFor(() => expect(screen.getByText(/The reason was not recorded/)).toBeTruthy())
  })
})

describe('new investigation form', () => {
  it('blocks the form with an explanation when the server cannot run research', async () => {
    const backend = new FakeBackend()
    backend.researchAvailable = false
    renderAt('/investigations/new', backend)
    await waitFor(() => expect(screen.getByText('New investigations are unavailable')).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Start investigation' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Question') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('stays usable when research is available', async () => {
    renderAt('/investigations/new', new FakeBackend())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start investigation' })).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Start investigation' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('New investigations are unavailable')).toBeNull()
  })
})
