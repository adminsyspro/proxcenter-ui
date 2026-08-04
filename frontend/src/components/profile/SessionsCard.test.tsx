import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import SessionsCard from './SessionsCard'

const SESSIONS_URL = '*/api/v1/auth/sessions'

function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    current: false,
    browser: 'Chrome',
    os: 'Windows',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
    ipAddress: '203.0.113.5',
    createdAt: '2026-07-01T10:00:00.000Z',
    lastSeenAt: '2026-08-01T09:30:00.000Z',
    ...overrides,
  }
}

describe('SessionsCard', () => {
  afterEach(() => cleanup())

  it('renders one row per session, marks the current one, and falls back to Unknown for an unidentifiable device', async () => {
    server.use(
      http.get(SESSIONS_URL, () =>
        HttpResponse.json({
          data: [
            makeSession({ id: 'current', current: true, browser: 'Firefox', os: 'macOS', ipAddress: '198.51.100.1' }),
            makeSession({ id: 'other', current: false, ipAddress: '203.0.113.5' }),
            makeSession({ id: 'mystery', current: false, browser: null, os: null, userAgent: null, ipAddress: '192.0.2.9' }),
          ],
        }),
      ),
    )

    renderWithProviders(<SessionsCard />)

    await screen.findByText('Firefox · macOS')
    expect(screen.getByText('Chrome · Windows')).toBeInTheDocument()

    // Both null -> translated "unknown device" fallback, not an empty cell.
    expect(screen.getByText('Unknown')).toBeInTheDocument()

    // Only the current session carries the chip marker.
    expect(screen.getAllByText('This device')).toHaveLength(1)

    // IP address and last-activity are shown per row, never in monospace.
    const ipText = screen.getByText('IP address: 203.0.113.5')
    expect(ipText).toBeInTheDocument()
    expect(ipText).not.toHaveStyle({ fontFamily: 'monospace' })
  })

  it('renders the empty state when there are no sessions', async () => {
    server.use(http.get(SESSIONS_URL, () => HttpResponse.json({ data: [] })))

    renderWithProviders(<SessionsCard />)

    expect(await screen.findByText('No active sessions.')).toBeInTheDocument()
  })

  it('shows the connection-error alert when the fetch fails', async () => {
    server.use(http.get(SESSIONS_URL, () => HttpResponse.error()))

    renderWithProviders(<SessionsCard />)

    expect(await screen.findByText('Connection error')).toBeInTheDocument()
  })

  it('revoking one row issues the single DELETE and refreshes the list', async () => {
    const user = userEvent.setup()
    let getCalls = 0
    let deleteOtherCalls = 0

    server.use(
      http.get(SESSIONS_URL, () => {
        getCalls += 1
        return HttpResponse.json({
          data: [
            makeSession({ id: 'current', current: true }),
            makeSession({ id: 'other', current: false }),
          ],
        })
      }),
      http.delete('*/api/v1/auth/sessions/other', () => {
        deleteOtherCalls += 1
        return HttpResponse.json({ data: { ok: true } })
      }),
    )

    renderWithProviders(<SessionsCard />)

    await screen.findByRole('button', { name: 'Sign out other sessions' })
    expect(getCalls).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByText('Sign out this session?')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(deleteOtherCalls).toBe(1))
    await waitFor(() => expect(getCalls).toBe(2))
  })

  it('"sign out other sessions" issues the collection DELETE and excludes the current session', async () => {
    const user = userEvent.setup()
    let getCalls = 0
    let deleteAllCalls = 0

    server.use(
      http.get(SESSIONS_URL, () => {
        getCalls += 1
        return HttpResponse.json({
          data: [
            makeSession({ id: 'current', current: true }),
            makeSession({ id: 'other', current: false }),
          ],
        })
      }),
      http.delete(SESSIONS_URL, () => {
        deleteAllCalls += 1
        return HttpResponse.json({ data: { revoked: 1 } })
      }),
    )

    renderWithProviders(<SessionsCard />)

    await screen.findByRole('button', { name: 'Sign out other sessions' })

    await user.click(screen.getByRole('button', { name: 'Sign out other sessions' }))
    await screen.findByText('Sign out all other sessions?')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(deleteAllCalls).toBe(1))
    await waitFor(() => expect(getCalls).toBe(2))
  })
})
