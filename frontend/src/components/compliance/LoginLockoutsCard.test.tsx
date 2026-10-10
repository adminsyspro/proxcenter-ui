import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import LoginLockoutsCard from './LoginLockoutsCard'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const mutate = vi.fn(async () => undefined)
let swrState: { data: any; isLoading: boolean } = { data: undefined, isLoading: false }
vi.mock('@/hooks/useSWRFetch', () => ({ useSWRFetch: () => ({ ...swrState, mutate }) }))

const lock = (kind: 'account' | 'ip', key: string, failedCount = 3) => ({
  kind,
  key,
  failedCount,
  lastFailedAt: '2026-10-10T06:00:00.000Z',
  lockedUntil: '2026-10-10T06:02:00.000Z',
})

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  mutate.mockClear()
  swrState = { data: undefined, isLoading: false }
})

describe('LoginLockoutsCard', () => {
  it('shows a spinner while loading', () => {
    swrState = { data: undefined, isLoading: true }
    render(<LoginLockoutsCard />)
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('says so when nothing is locked', () => {
    swrState = { data: { data: [] }, isLoading: false }
    render(<LoginLockoutsCard />)
    expect(screen.getByText('compliance.loginLockouts.empty')).toBeTruthy()
  })

  it('lists account and IP locks with their kind and count', () => {
    swrState = { data: { data: [lock('account', 'alice@example.com', 5), lock('ip', '2001:db8:1:2::/64')] }, isLoading: false }
    render(<LoginLockoutsCard />)
    expect(screen.getByText('alice@example.com')).toBeTruthy()
    expect(screen.getByText('2001:db8:1:2::/64')).toBeTruthy()
    expect(screen.getByText('compliance.loginLockouts.kindAccount')).toBeTruthy()
    expect(screen.getByText('compliance.loginLockouts.kindIp')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy() // count chip in the header
  })

  it('unlocks a row through the DELETE route and refreshes', async () => {
    swrState = { data: { data: [lock('account', 'alice@example.com')] }, isLoading: false }
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    render(<LoginLockoutsCard />)
    await userEvent.click(screen.getByRole('button', { name: /compliance.loginLockouts.unlock/ }))
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/compliance/login-lockouts?kind=account&key=alice%40example.com', { method: 'DELETE' })
    expect(screen.queryByText('compliance.loginLockouts.unlockFailed')).toBeNull()
  })

  it('treats a 404 as an already expired lock', async () => {
    swrState = { data: { data: [lock('ip', '203.0.113.7')] }, isLoading: false }
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    render(<LoginLockoutsCard />)
    await userEvent.click(screen.getByRole('button', { name: /compliance.loginLockouts.unlock/ }))
    await waitFor(() => expect(mutate).toHaveBeenCalled())
    expect(screen.queryByText('compliance.loginLockouts.unlockFailed')).toBeNull()
  })

  it('shows an error when the unlock fails and lets it be dismissed', async () => {
    swrState = { data: { data: [lock('account', 'alice@example.com')] }, isLoading: false }
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    render(<LoginLockoutsCard />)
    await userEvent.click(screen.getByRole('button', { name: /compliance.loginLockouts.unlock/ }))
    expect(await screen.findByText('compliance.loginLockouts.unlockFailed')).toBeTruthy()
    expect(mutate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(screen.queryByText('compliance.loginLockouts.unlockFailed')).toBeNull()
  })

  it('paginates beyond ten locks', async () => {
    const many = Array.from({ length: 12 }, (_, i) => lock('account', `user${i}@example.com`))
    swrState = { data: { data: many }, isLoading: false }
    render(<LoginLockoutsCard />)
    expect(screen.getByText('user0@example.com')).toBeTruthy()
    expect(screen.queryByText('user10@example.com')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getByText('user10@example.com')).toBeTruthy()
    expect(screen.queryByText('user0@example.com')).toBeNull()
  })
})
