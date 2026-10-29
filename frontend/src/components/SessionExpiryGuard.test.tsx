import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import SessionExpiryGuard, { SESSION_RECHECK_MS } from './SessionExpiryGuard'

// This file drives its own session/router states, overriding the fixed
// authenticated/idle stubs that src/__tests__/setup/renderWithProviders.tsx
// installs for other tests — this component has no other dependency
// (no i18n, no theme), so it renders standalone like
// src/components/guards/FeatureGuard.test.tsx does. Its one fetch, the
// confirmation of an "unauthenticated" status, is stubbed per test.
const useSessionMock = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}))

const replaceMock = vi.fn()
let currentPathname = '/dashboard'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => currentPathname,
}))

const updateMock = vi.fn()
const fetchMock = vi.fn()

const signedOut = () => Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
const alive = () => Promise.resolve(new Response(JSON.stringify({ user: { email: 'a@b.c' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

describe('SessionExpiryGuard', () => {
  beforeEach(() => {
    useSessionMock.mockReset()
    replaceMock.mockClear()
    updateMock.mockReset()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    currentPathname = '/dashboard'
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('redirects to /login with a callbackUrl once the server confirms there is no session', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated', update: updateMock })
    fetchMock.mockImplementation(signedOut)

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1))
    expect(replaceMock).toHaveBeenCalledWith('/login?callbackUrl=%2Fdashboard')
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ cache: 'no-store' }))
  })

  it('stays on the page when the session check fails on the network', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated', update: updateMock })
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('stays on the page when a proxy answers the session check with an HTML error page', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated', update: updateMock })
    fetchMock.mockResolvedValue(new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('stays on the page when a 200 carries a body that is not JSON', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated', update: updateMock })
    fetchMock.mockResolvedValue(new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('resyncs the session provider when the session turns out to be alive', async () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated', update: updateMock })
    fetchMock.mockImplementation(alive)

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('checks again later after a failed check, and redirects once the server confirms the sign-out', async () => {
    vi.useFakeTimers()
    useSessionMock.mockReturnValue({ status: 'unauthenticated', update: updateMock })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(signedOut)

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_RECHECK_MS) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(replaceMock).toHaveBeenCalledWith('/login?callbackUrl=%2Fdashboard')
  })

  it('stops checking once the session is authenticated again', async () => {
    vi.useFakeTimers()
    useSessionMock.mockReturnValue({ status: 'unauthenticated', update: updateMock })
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const { rerender } = render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    useSessionMock.mockReturnValue({ status: 'authenticated', update: updateMock })
    rerender(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)
    await act(async () => { await vi.advanceTimersByTimeAsync(SESSION_RECHECK_MS * 3) })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('does nothing while the initial session fetch is loading', () => {
    useSessionMock.mockReturnValue({ status: 'loading', update: updateMock })

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    expect(replaceMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing while authenticated', () => {
    useSessionMock.mockReturnValue({ status: 'authenticated', update: updateMock })

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    expect(replaceMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('encodes the current path in callbackUrl, matching proxy.ts', async () => {
    currentPathname = '/settings/security'
    useSessionMock.mockReturnValue({ status: 'unauthenticated', update: updateMock })
    fetchMock.mockImplementation(signedOut)

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login?callbackUrl=%2Fsettings%2Fsecurity'))
  })

  it('still renders children (no signOut round trip, no blocking gate)', () => {
    useSessionMock.mockReturnValue({ status: 'authenticated', update: updateMock })

    const { getByText } = render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    expect(getByText('content')).toBeInTheDocument()
  })
})
