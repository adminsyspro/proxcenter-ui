import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import SessionExpiryGuard from './SessionExpiryGuard'

// This file drives its own session/router states, overriding the fixed
// authenticated/idle stubs that src/__tests__/setup/renderWithProviders.tsx
// installs for other tests — this component has no other dependency
// (no i18n, no theme, no fetch), so it renders standalone like
// src/components/guards/FeatureGuard.test.tsx does.
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

describe('SessionExpiryGuard', () => {
  beforeEach(() => {
    useSessionMock.mockReset()
    replaceMock.mockClear()
    currentPathname = '/dashboard'
  })
  afterEach(() => cleanup())

  it('redirects to /login with a callbackUrl when the session is unauthenticated', () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated' })

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    expect(replaceMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).toHaveBeenCalledWith('/login?callbackUrl=%2Fdashboard')
  })

  it('does nothing while the initial session fetch is loading', () => {
    useSessionMock.mockReturnValue({ status: 'loading' })

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('does nothing while authenticated', () => {
    useSessionMock.mockReturnValue({ status: 'authenticated' })

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('encodes the current path in callbackUrl, matching middleware.ts', () => {
    currentPathname = '/settings/security'
    useSessionMock.mockReturnValue({ status: 'unauthenticated' })

    render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    expect(replaceMock).toHaveBeenCalledWith('/login?callbackUrl=%2Fsettings%2Fsecurity')
  })

  it('still renders children (no signOut round trip, no blocking gate)', () => {
    useSessionMock.mockReturnValue({ status: 'authenticated' })

    const { getByText } = render(<SessionExpiryGuard><div>content</div></SessionExpiryGuard>)

    expect(getByText('content')).toBeInTheDocument()
  })
})
