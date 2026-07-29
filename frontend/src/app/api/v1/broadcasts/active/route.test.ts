import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { sessionMock, activeMock, rolesMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  activeMock: vi.fn(),
  rolesMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => sessionMock() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/db/broadcasts', () => ({
  listActiveForPrincipal: (...a: any[]) => activeMock(...a),
  resolvePrincipalRoles: (...a: any[]) => rolesMock(...a),
}))

const publicBanner = {
  id: 'b1',
  message: 'Maintenance 22:00 UTC',
  linkUrl: null,
  linkLabel: null,
  bgColor: '#f59e0b',
  fgColor: '#000000',
  dismissible: true,
  updatedAt: '2026-08-01T10:00:00.000Z',
}

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ user: { id: 'u1', tenantId: 'tenant-a' } })
  activeMock.mockReset().mockResolvedValue([publicBanner])
  rolesMock.mockReset().mockResolvedValue({ roleIds: ['role_viewer'], legacyRole: 'viewer' })
})

describe('GET /api/v1/broadcasts/active', () => {
  it('returns the matching banners for the session principal', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: [publicBanner] })
  })

  it('builds the principal from the raw session tenant and the resolved roles', async () => {
    const { GET } = await import('./route')
    await callRoute(GET)
    expect(rolesMock).toHaveBeenCalledWith('u1', 'tenant-a')
    expect(activeMock).toHaveBeenCalledWith(
      { userId: 'u1', tenantId: 'tenant-a', roleIds: ['role_viewer'], legacyRole: 'viewer' },
      expect.any(Date),
    )
  })

  it('defaults the tenant to default when the session carries none', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1' } })
    const { GET } = await import('./route')
    await callRoute(GET)
    expect(rolesMock).toHaveBeenCalledWith('u1', 'default')
  })

  it('never leaks targeting metadata', async () => {
    const { GET } = await import('./route')
    const payload = await readJson<{ data: Record<string, unknown>[] }>(await callRoute(GET))
    for (const key of ['targetKind', 'targetIds', 'createdBy', 'enabled', 'startsAt', 'endsAt']) {
      expect(payload!.data[0]).not.toHaveProperty(key)
    }
  })

  it('refuses an unauthenticated caller with 401', async () => {
    sessionMock.mockResolvedValue(null)
    const { GET } = await import('./route')
    expect((await callRoute(GET)).status).toBe(401)
    expect(activeMock).not.toHaveBeenCalled()
  })

  it('returns an empty list rather than an error when the query blows up', async () => {
    activeMock.mockRejectedValue(new Error('db down'))
    const { GET } = await import('./route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: [] })
  })
})
