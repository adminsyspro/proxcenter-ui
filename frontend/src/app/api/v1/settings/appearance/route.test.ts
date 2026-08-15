import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const { getServerSession, demoResponse, getUserAppearance, setUserAppearance } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  demoResponse: vi.fn(),
  getUserAppearance: vi.fn(),
  setUserAppearance: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse }))
vi.mock('@/lib/db/userPreferences', () => ({ getUserAppearance, setUserAppearance }))

beforeEach(() => {
  vi.clearAllMocks()
  demoResponse.mockReturnValue(null)
  getServerSession.mockResolvedValue({ user: { id: 'user-1', tenantId: 'tenant-1' } })
  getUserAppearance.mockResolvedValue(null)
  setUserAppearance.mockResolvedValue({})
})

describe('GET /api/v1/settings/appearance', () => {
  it('returns 401 without a session', async () => {
    getServerSession.mockResolvedValue(null)
    const { GET } = await import('./route')

    const response = await callRoute(GET, { method: 'GET' })

    expect(response.status).toBe(401)
    expect(getUserAppearance).not.toHaveBeenCalled()
  })

  it('returns an empty non-stored response when no row exists', async () => {
    const { GET } = await import('./route')

    const response = await callRoute(GET, { method: 'GET' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: {}, stored: false })
  })

  it('returns the stored row for the session principal', async () => {
    getUserAppearance.mockResolvedValue({ mode: 'dark' })
    const { GET } = await import('./route')

    const response = await callRoute(GET, { method: 'GET' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { mode: 'dark' }, stored: true })
    expect(getUserAppearance).toHaveBeenCalledWith('tenant-1', 'user-1')
  })

  it("falls back to tenant 'default' when the session has no tenantId", async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    const { GET } = await import('./route')

    await callRoute(GET, { method: 'GET' })

    expect(getUserAppearance).toHaveBeenCalledWith('default', 'user-1')
  })
})

describe('PUT /api/v1/settings/appearance', () => {
  it('returns 401 without a session and never writes', async () => {
    getServerSession.mockResolvedValue(null)
    const { PUT } = await import('./route')

    const response = await callRoute(PUT, { method: 'PUT', body: { mode: 'dark' } })

    expect(response.status).toBe(401)
    expect(setUserAppearance).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'an array', body: [] },
    { label: 'a string', body: '"x"' },
    { label: 'malformed JSON', body: '{not-json' },
  ])('returns 400 for $label and never writes', async ({ body }) => {
    const { PUT } = await import('./route')

    const response = await callRoute(PUT, { method: 'PUT', body })

    expect(response.status).toBe(400)
    expect(setUserAppearance).not.toHaveBeenCalled()
  })

  it('passes a valid raw body to the store', async () => {
    const rawBody = { primaryColor: '#FFD200', unknownFutureKey: 'value' }
    setUserAppearance.mockResolvedValue({ primaryColor: '#FFD200' })
    const { PUT } = await import('./route')

    const response = await callRoute(PUT, { method: 'PUT', body: rawBody })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { primaryColor: '#FFD200' }, stored: true })
    expect(setUserAppearance).toHaveBeenCalledWith('tenant-1', 'user-1', rawBody)
  })

  it('ignores user and tenant ids in the body and writes only for the session principal', async () => {
    const body = { userId: 'victim', tenantId: 'other-tenant', mode: 'dark' }
    const { PUT } = await import('./route')

    await callRoute(PUT, { method: 'PUT', body })

    expect(setUserAppearance).toHaveBeenCalledWith('tenant-1', 'user-1', body)
  })
})

describe('demo mode', () => {
  it.each(['GET', 'PUT'] as const)('short-circuits %s before session or store access', async method => {
    const demo = Response.json({ demo: true }, { status: 418 })
    demoResponse.mockReturnValue(demo)
    const route = await import('./route')

    const response = await callRoute(route[method], {
      method,
      ...(method === 'PUT' ? { body: { mode: 'dark' } } : {}),
    })

    expect(response).toBe(demo)
    expect(getServerSession).not.toHaveBeenCalled()
    expect(getUserAppearance).not.toHaveBeenCalled()
    expect(setUserAppearance).not.toHaveBeenCalled()
  })
})
