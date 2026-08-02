import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getTenantConnectionIdsMock, getCurrentTenantIdMock } = vi.hoisted(() => ({
  getTenantConnectionIdsMock: vi.fn<() => Promise<Set<string>>>(),
  getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: getTenantConnectionIdsMock,
  getCurrentTenantId: getCurrentTenantIdMock,
}))

import { resolveVisibleConnectionIds, resolvePublicRequestScope, restrictToTokenScope } from './scope'

beforeEach(() => {
  vi.clearAllMocks()
  getTenantConnectionIdsMock.mockResolvedValue(new Set(['conn-a', 'conn-b', 'conn-c']))
  getCurrentTenantIdMock.mockResolvedValue('tenant-1')
})

describe('resolveVisibleConnectionIds', () => {
  it('returns every tenant connection when connectionIds is null', async () => {
    const visible = await resolveVisibleConnectionIds({ connectionIds: null })
    expect(visible).toEqual(new Set(['conn-a', 'conn-b', 'conn-c']))
  })

  it('intersects with the token connection list', async () => {
    const visible = await resolveVisibleConnectionIds({ connectionIds: ['conn-b'] })
    expect(visible).toEqual(new Set(['conn-b']))
  })

  it('silently drops a deleted connection still referenced by the token', async () => {
    const visible = await resolveVisibleConnectionIds({
      connectionIds: ['conn-b', 'conn-deleted'],
    })
    expect(visible).toEqual(new Set(['conn-b']))
  })

  it('compares connection ids by exact equality: conn-1 never matches conn-10', async () => {
    getTenantConnectionIdsMock.mockResolvedValue(new Set(['conn-1', 'conn-10']))
    const visible = await resolveVisibleConnectionIds({ connectionIds: ['conn-1'] })
    expect(visible).toEqual(new Set(['conn-1']))
  })

  it('fails CLOSED (restricted to nothing) when connectionIds is ABSENT, not the same as an explicit null', async () => {
    // `connectionIds` is a required field on the type; this exercises the
    // only way to reach a missing one at runtime -- bypassing the type, the
    // same as an unvalidated `as any` boundary would.
    const principal = {} as unknown as { connectionIds: string[] | null }
    const visible = await resolveVisibleConnectionIds(principal)
    expect(visible).toEqual(new Set())
  })

  it('an EXPLICIT null stays the deliberate "unrestricted" (unlike the absent case above)', async () => {
    const visible = await resolveVisibleConnectionIds({ connectionIds: null })
    expect(visible).toEqual(new Set(['conn-a', 'conn-b', 'conn-c']))
  })
})

describe('restrictToTokenScope', () => {
  const connections = [{ id: 'conn-a' }, { id: 'conn-b' }, { id: 'conn-c' }]

  it('passes every connection through untouched for a session principal', async () => {
    const out = await restrictToTokenScope(connections, { kind: 'session', connectionIds: null })
    expect(out).toEqual(connections)
    expect(getTenantConnectionIdsMock).not.toHaveBeenCalled()
  })

  it('passes every connection through untouched when no principal is given', async () => {
    const out = await restrictToTokenScope(connections)
    expect(out).toEqual(connections)
    expect(getTenantConnectionIdsMock).not.toHaveBeenCalled()
  })

  it('restricts to the token perimeter, intersected with the tenant connections', async () => {
    const out = await restrictToTokenScope(connections, { kind: 'token', connectionIds: ['conn-b'] })
    expect(out).toEqual([{ id: 'conn-b' }])
  })

  it('a null token perimeter keeps every tenant connection', async () => {
    const out = await restrictToTokenScope(connections, { kind: 'token', connectionIds: null })
    expect(out).toEqual(connections)
  })

  it('fails CLOSED for a token whose connectionIds is ABSENT (bypassing the type)', async () => {
    const principal = { kind: 'token' } as unknown as { kind: string; connectionIds: string[] | null }
    const out = await restrictToTokenScope(connections, principal)
    expect(out).toEqual([])
  })
})

describe('resolvePublicRequestScope', () => {
  it('uses the principal tenant and perimeter when given', async () => {
    const scope = await resolvePublicRequestScope({ tenantId: 'tok-tenant', connectionIds: ['conn-a'] })
    expect(scope.tenantId).toBe('tok-tenant')
    expect(scope.visible).toEqual(new Set(['conn-a']))
    expect(getCurrentTenantIdMock).not.toHaveBeenCalled()
  })

  it('falls back to the ambient tenant for session callers', async () => {
    const scope = await resolvePublicRequestScope(undefined)
    expect(scope.tenantId).toBe('tenant-1')
    expect(scope.visible).toEqual(new Set(['conn-a', 'conn-b', 'conn-c']))
  })
})
