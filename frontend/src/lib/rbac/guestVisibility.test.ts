// frontend/src/lib/rbac/guestVisibility.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// loadUserGrants is internal, so the grants are driven through the Prisma
// client the same way inherit-grants.test.ts does it. vi.hoisted keeps the
// mock fns reachable from inside the hoisted vi.mock factory.
const { findFirstMock, roleFindManyMock, permFindManyMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn<(...a: any[]) => Promise<any>>(),
  roleFindManyMock: vi.fn<(...a: any[]) => Promise<any>>(),
  permFindManyMock: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacUserRole: { findFirst: findFirstMock, findMany: roleFindManyMock },
    rbacUserPermission: { findMany: permFindManyMock },
  },
}))

import type { Principal } from '@/lib/auth/principal'
import { loadGuestVisibilityCheck, PERMISSIONS } from './index'

/** Direct grant row as loadUserGrants selects it. */
const grant = (scopeType: string, scopeTarget: string | null) => ({
  scopeType,
  scopeTarget,
  permission: { name: PERMISSIONS.VM_VIEW },
})

function tokenPrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    kind: 'token',
    tokenId: 'tok_x',
    tenantId: 'default',
    permissions: new Set([PERMISSIONS.VM_VIEW]),
    connectionIds: null,
    ...overrides,
  }
}

describe('loadGuestVisibilityCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Only user-admin holds role_super_admin.
    findFirstMock.mockImplementation(async (args: any) =>
      args?.where?.userId === 'user-admin' ? { id: 'assignment-1' } : null,
    )
    roleFindManyMock.mockResolvedValue([])
    permFindManyMock.mockImplementation(async (args: any) => {
      if (args?.where?.userId === 'user-1') return [grant('tag', 'prod')]
      if (args?.where?.userId === 'user-pool') return [grant('pool', 'poolA')]
      return []
    })
  })

  it('accepts a guest carrying the granted tag, rejects the others', async () => {
    const check = await loadGuestVisibilityCheck('user-1', PERMISSIONS.VM_VIEW, 'tenant-1')
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100', tags: 'prod;web' })).toBe(true)
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '101', tags: 'staging' })).toBe(false)
  })

  it('parses a comma or semicolon separated tag string the same way', async () => {
    const check = await loadGuestVisibilityCheck('user-1', PERMISSIONS.VM_VIEW, 'tenant-1')
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100', tags: 'web,prod' })).toBe(true)
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100', tags: ['prod'] })).toBe(true)
  })

  it('loads the grants ONCE for the whole predicate lifetime', async () => {
    const check = await loadGuestVisibilityCheck('user-1', PERMISSIONS.VM_VIEW, 'tenant-1')
    check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100', tags: 'prod' })
    check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '101', tags: 'prod' })
    expect(permFindManyMock).toHaveBeenCalledTimes(1)
  })

  it('resolves the grants against the tenant it was asked for', async () => {
    await loadGuestVisibilityCheck('user-1', PERMISSIONS.VM_VIEW, 'tenant-1')
    expect(permFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) }),
    )
  })

  it('accepts a pool-granted guest and rejects a guest with no pool', async () => {
    const check = await loadGuestVisibilityCheck('user-pool', PERMISSIONS.VM_VIEW, 'tenant-1')
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100', pool: 'poolA' })).toBe(true)
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100' })).toBe(false)
  })

  it('rejects a guest whose identity is incomplete', async () => {
    const check = await loadGuestVisibilityCheck('user-1', PERMISSIONS.VM_VIEW, 'tenant-1')
    expect(check({ connId: 'connA', tags: 'prod' })).toBe(false)
  })

  it('rejects everything for a user with no grant at all', async () => {
    const check = await loadGuestVisibilityCheck('user-none', PERMISSIONS.VM_VIEW, 'tenant-1')
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100', tags: 'prod' })).toBe(false)
  })

  it('returns true for everything when the user is a super admin', async () => {
    const check = await loadGuestVisibilityCheck('user-admin', PERMISSIONS.VM_VIEW, 'tenant-1')
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100' })).toBe(true)
  })

  it('honours a token principal: permission missing => nothing visible', async () => {
    const check = await loadGuestVisibilityCheck(
      tokenPrincipal({ permissions: new Set<string>() }),
    )
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100' })).toBe(false)
  })

  it('honours a token principal: connection allow-list', async () => {
    const check = await loadGuestVisibilityCheck(tokenPrincipal({ connectionIds: ['connA'] }))
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100' })).toBe(true)
    expect(check({ connId: 'connB', node: 'n1', type: 'qemu', vmid: '100' })).toBe(false)
  })

  it('honours a token principal: a null allow-list means every connection', async () => {
    const check = await loadGuestVisibilityCheck(tokenPrincipal())
    expect(check({ connId: 'connZ', node: 'n1', type: 'qemu', vmid: '100' })).toBe(true)
    // No DB round trip is ever made for a token principal.
    expect(permFindManyMock).not.toHaveBeenCalled()
  })

  it('defaults to vm.view when no permission is passed', async () => {
    const check = await loadGuestVisibilityCheck('user-1', undefined, 'tenant-1')
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100', tags: 'prod' })).toBe(true)
  })

  it('accepts a numeric vmid the same way as a string one', async () => {
    const check = await loadGuestVisibilityCheck('user-1', PERMISSIONS.VM_VIEW, 'tenant-1')
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: 100, tags: 'prod' })).toBe(true)
  })

  it('matches a node-scoped grant on the resource id, not only tag/pool', async () => {
    permFindManyMock.mockResolvedValue([grant('node', 'connA:n1')])
    const check = await loadGuestVisibilityCheck('user-node', PERMISSIONS.VM_VIEW, 'tenant-1')
    expect(check({ connId: 'connA', node: 'n1', type: 'qemu', vmid: '100' })).toBe(true)
    expect(check({ connId: 'connA', node: 'n2', type: 'qemu', vmid: '200' })).toBe(false)
  })
})
