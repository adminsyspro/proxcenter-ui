import { beforeEach, describe, expect, it, vi } from 'vitest'

// `server-only` throws by design outside a Server Component; neutralise the
// marker so this module can be exercised under the node test project.
vi.mock('server-only', () => ({}))

vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

const getServerSession = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }))

const getUserAppearance = vi.fn()

vi.mock('@/lib/db/userPreferences', () => ({
  getUserAppearance: (...args: unknown[]) => getUserAppearance(...args),
}))

const { getAppearanceHydration, getStoredAppearance } = await import('./server')

describe('getAppearanceHydration', () => {
  beforeEach(() => {
    getServerSession.mockReset()
    getUserAppearance.mockReset()
  })

  it('reports an anonymous request without touching the store', async () => {
    getServerSession.mockResolvedValue(null)

    await expect(getAppearanceHydration()).resolves.toEqual({ authenticated: false, userId: null, stored: null })
    expect(getUserAppearance).not.toHaveBeenCalled()
  })

  it('treats a session with no user id as anonymous', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'a@b.c' } })

    await expect(getAppearanceHydration()).resolves.toEqual({ authenticated: false, userId: null, stored: null })
    expect(getUserAppearance).not.toHaveBeenCalled()
  })

  it('reads the store with the session tenant and user', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 'acme' } })
    getUserAppearance.mockResolvedValue({ primaryColor: '#FFD200' })

    await expect(getAppearanceHydration()).resolves.toEqual({
      authenticated: true,
      userId: 'u1',
      stored: { primaryColor: '#FFD200' },
    })
    expect(getUserAppearance).toHaveBeenCalledWith('acme', 'u1')
  })

  it('falls back to the default tenant when the session carries none', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1' } })
    getUserAppearance.mockResolvedValue(null)

    await expect(getAppearanceHydration()).resolves.toEqual({ authenticated: true, userId: 'u1', stored: null })
    expect(getUserAppearance).toHaveBeenCalledWith('default', 'u1')
  })

  it('keeps a signed-in user distinguishable from one who never saved anything', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 'default' } })
    getUserAppearance.mockResolvedValue(null)

    const hydration = await getAppearanceHydration()

    expect(hydration.authenticated).toBe(true)
    expect(hydration.stored).toBeNull()
  })

  it('never lets a database failure take the layout down', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 'default' } })
    getUserAppearance.mockRejectedValue(new Error('connection refused'))

    await expect(getAppearanceHydration()).resolves.toEqual({ authenticated: false, userId: null, stored: null })
  })

  it('never lets a broken session take the layout down', async () => {
    getServerSession.mockRejectedValue(new Error('bad JWT'))

    await expect(getAppearanceHydration()).resolves.toEqual({ authenticated: false, userId: null, stored: null })
  })
})

describe('getStoredAppearance', () => {
  beforeEach(() => {
    getServerSession.mockReset()
    getUserAppearance.mockReset()
  })

  it('returns the stored blob alone', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 'default' } })
    getUserAppearance.mockResolvedValue({ mode: 'dark' })

    await expect(getStoredAppearance()).resolves.toEqual({ mode: 'dark' })
  })

  it('returns null for an anonymous request', async () => {
    getServerSession.mockResolvedValue(null)

    await expect(getStoredAppearance()).resolves.toBeNull()
  })
})
