/**
 * MOCK-based tests for the permission hierarchy added with the per-key
 * config gating (#897): a `vm.config` grant covers every `vm.config.*`
 * right, `checkPermissions` gates several rights in one pass for tokens and
 * users alike, and `expandPermissionHierarchy` mirrors that for the client.
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/rbac/checkPermissions.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const m = vi.hoisted(() => ({
  getPrincipal: vi.fn(),
  rejectionToResponse: vi.fn(),
  resolveVmMeta: vi.fn(),
  getTenantConnectionIds: vi.fn(),
  prisma: {
    rbacUserRole: { findFirst: vi.fn(), findMany: vi.fn() },
    rbacUserPermission: { findMany: vi.fn() },
  } as any,
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/auth/principal', () => ({
  getPrincipal: (...a: unknown[]) => m.getPrincipal(...a),
  rejectionToResponse: (...a: unknown[]) => m.rejectionToResponse(...a),
}))
vi.mock('@/lib/cache/vmMetaCache', () => ({ resolveVmMeta: (...a: unknown[]) => m.resolveVmMeta(...a) }))
vi.mock('@/lib/cache/inventoryCache', () => ({ getTenantInventoriesFromCache: vi.fn() }))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getTenantConnectionIds: (...a: unknown[]) => m.getTenantConnectionIds(...a),
}))

import { expandScopes } from '@/lib/api-tokens/scopes'
import { checkPermission, checkPermissions, expandPermissionHierarchy, hasPermission, holdsBroadPermission, PERMISSIONS } from './index'

const VM = 'conn-1:pve1:qemu:100'

const tokenPrincipal = (
  permissions: string[] | Set<string>,
  connectionIds: string[] | null | undefined = ['conn-1'],
  tenantId = 'default',
) => ({
  ok: true,
  principal: { kind: 'token', tokenId: 'tok_x', tenantId, permissions: new Set(permissions), connectionIds },
})
const userPrincipal = { ok: true, principal: { kind: 'user', userId: 'u1', tenantId: 't1' } }

/** One role assignment carrying the given permissions on the given scope. */
function grantRole(permissions: string[], scopeType = 'global', scopeTarget: string | null = null) {
  m.prisma.rbacUserRole.findMany.mockResolvedValue([{
    scopeType, scopeTarget,
    role: { defaultScopes: null, permissions: permissions.map((name) => ({ permission: { name } })) },
  }])
}

async function errorOf(res: NextResponse | null) {
  return res ? { status: res.status, ...(await res.json()) } : null
}

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.rbacUserRole.findFirst.mockResolvedValue(null)
  m.prisma.rbacUserRole.findMany.mockResolvedValue([])
  m.prisma.rbacUserPermission.findMany.mockResolvedValue([])
  m.resolveVmMeta.mockReturnValue(null)
  m.getTenantConnectionIds.mockResolvedValue(new Set(['connA']))
})

describe('expandPermissionHierarchy', () => {
  it('adds every child of a granted parent, and nothing else', () => {
    expect([...expandPermissionHierarchy(new Set(['vm.config', 'vm.view']))].sort((a, b) => a.localeCompare(b))).toEqual([
      'vm.config', 'vm.config.boot', 'vm.config.hardware', 'vm.config.media', 'vm.config.nic', 'vm.config.nic.link', 'vm.view',
    ])
    expect([...expandPermissionHierarchy(new Set(['vm.config.nic']))].sort((a, b) => a.localeCompare(b))).toEqual(['vm.config.nic', 'vm.config.nic.link'])
    expect(expandPermissionHierarchy(new Set(['vm.config.media']))).toEqual(new Set(['vm.config.media']))
  })
})

describe('checkPermissions: API token', () => {
  it('passes without any lookup for an empty list', async () => {
    expect(await checkPermissions([])).toBeNull()
    expect(m.getPrincipal).not.toHaveBeenCalled()
  })

  it('a vm.config grant covers every vm.config.* right, but a bare vm grant covers nothing below it', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.config']))
    expect(await checkPermissions([PERMISSIONS.VM_CONFIG_MEDIA, PERMISSIONS.VM_CONFIG_NIC_LINK], 'vm', VM)).toBeNull()

    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm']))
    expect(await errorOf(await checkPermissions([PERMISSIONS.VM_CONFIG_MEDIA], 'vm', VM))).toEqual({ status: 403, error: 'Permission denied: vm.config.media' })
  })

  it('names the first missing right, and keeps the connection perimeter', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.config.media', 'vm.view']))
    expect(await errorOf(await checkPermissions([PERMISSIONS.VM_CONFIG_MEDIA, PERMISSIONS.VM_CONFIG_BOOT, PERMISSIONS.VM_VIEW], 'vm', VM)))
      .toEqual({ status: 403, error: 'Permission denied: vm.config.boot' })

    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.config'], ['conn-9']))
    expect(await errorOf(await checkPermissions([PERMISSIONS.VM_CONFIG_MEDIA, PERMISSIONS.VM_CONFIG_BOOT], 'vm', VM)))
      .toEqual({ status: 403, error: 'Permission denied: vm.config.media' })
  })
})

describe('checkPermissions: session user', () => {
  beforeEach(() => {
    m.getPrincipal.mockResolvedValue(userPrincipal)
  })

  it('a global role carrying vm.config grants every vm.config.* right in one pass', async () => {
    grantRole(['vm.config'])
    expect(await checkPermissions([PERMISSIONS.VM_CONFIG_HARDWARE, PERMISSIONS.VM_CONFIG_BOOT], 'vm', VM)).toBeNull()
    // One round trip for roles, one for direct grants, whatever the number of rights.
    expect(m.prisma.rbacUserRole.findMany).toHaveBeenCalledTimes(1)
    expect(m.prisma.rbacUserPermission.findMany).toHaveBeenCalledTimes(1)
  })

  it('refuses on the first right the grants do not cover', async () => {
    grantRole(['vm.config.media', 'vm.view'])
    expect(await errorOf(await checkPermissions([PERMISSIONS.VM_CONFIG_MEDIA, 'vm.power'], 'vm', VM)))
      .toEqual({ status: 403, error: 'Permission denied: vm.power' })
  })

  it('a super admin passes everything', async () => {
    m.prisma.rbacUserRole.findFirst.mockResolvedValue({ id: 'assignment' })
    expect(await checkPermissions([PERMISSIONS.VM_CONFIG_HARDWARE, 'vm.power'], 'vm', VM)).toBeNull()
    expect(m.prisma.rbacUserRole.findMany).not.toHaveBeenCalled()
  })

  it('a tag-scoped grant is retried with the guest tags, and refused when the guest is unknown', async () => {
    grantRole(['vm.config'], 'tag', 'prod')
    m.resolveVmMeta.mockReturnValue({ tags: ['prod', 'web'], pool: undefined })
    expect(await checkPermissions([PERMISSIONS.VM_CONFIG_MEDIA, PERMISSIONS.VM_CONFIG_BOOT], 'vm', VM)).toBeNull()
    expect(m.resolveVmMeta).toHaveBeenCalledWith(VM, 't1')

    m.resolveVmMeta.mockReturnValue(null)
    expect(await errorOf(await checkPermissions([PERMISSIONS.VM_CONFIG_MEDIA], 'vm', VM))).toEqual({ status: 403, error: 'Permission denied: vm.config.media' })
  })

  it('401 without a session, and the principal rejection as is', async () => {
    m.getPrincipal.mockResolvedValue({ ok: true, principal: null })
    expect(await errorOf(await checkPermissions([PERMISSIONS.VM_CONFIG_MEDIA, PERMISSIONS.VM_CONFIG_BOOT]))).toEqual({ status: 401, error: 'Not authenticated' })

    m.getPrincipal.mockResolvedValue({ ok: false, rejection: 'expired' })
    m.rejectionToResponse.mockReturnValue(NextResponse.json({ error: 'Token expired' }, { status: 401 }))
    expect(await errorOf(await checkPermissions([PERMISSIONS.VM_CONFIG_MEDIA, PERMISSIONS.VM_CONFIG_BOOT]))).toEqual({ status: 401, error: 'Token expired' })
    expect(m.rejectionToResponse).toHaveBeenCalledWith('expired')
  })
})


describe('sensitive NIC permissions require explicit grants', () => {
  for (const permission of ['vm.config.nic.mac', 'vm.config.nic.vlan']) {
    it(`does not inherit ${permission} for sessions or tokens`, async () => {
      m.getPrincipal.mockResolvedValue(userPrincipal)
      grantRole(['vm.config', 'vm.config.nic'])
      expect((await checkPermissions([permission], 'vm', VM))?.status).toBe(403)
      m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.config', 'vm.config.nic']))
      expect((await checkPermissions([permission], 'vm', VM))?.status).toBe(403)
      m.getPrincipal.mockResolvedValue(tokenPrincipal([permission]))
      expect(await checkPermissions([permission], 'vm', VM)).toBeNull()
      expect(expandPermissionHierarchy(new Set(['vm.config']))).not.toContain(permission)
    })
    it(`keeps explicit ${permission} scoped to its VM`, async () => {
      m.getPrincipal.mockResolvedValue(userPrincipal)
      grantRole([permission], 'vm', VM)
      expect(await checkPermissions([permission], 'vm', VM)).toBeNull()
      expect((await checkPermissions([permission], 'vm', 'conn-1:pve1:qemu:101'))?.status).toBe(403)
    })
  }
})

describe('token checks are confined to the token tenant connections', () => {
  const VM_A = 'connA:n1:qemu:100'
  const VM_B = 'connB:n1:qemu:100'

  it('a non-default tenant token with a null perimeter is refused a connection of another tenant', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.start'], null, 't1'))
    expect(await errorOf(await checkPermission(PERMISSIONS.VM_START, 'vm', VM_B))).toEqual({ status: 403, error: 'Permission denied: vm.start' })
    expect(await checkPermission(PERMISSIONS.VM_START, 'vm', VM_A)).toBeNull()
  })

  it('checkPermissions applies the same confinement to every right', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.start', 'vm.view'], null, 't1'))
    expect(await errorOf(await checkPermissions([PERMISSIONS.VM_VIEW, PERMISSIONS.VM_START], 'vm', VM_B))).toEqual({ status: 403, error: 'Permission denied: vm.view' })
    expect(await checkPermissions([PERMISSIONS.VM_VIEW, PERMISSIONS.VM_START], 'vm', VM_A)).toBeNull()
  })

  it('confines raw connection ids too, and keeps the explicit perimeter on top', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['connection.view', 'vm.start'], ['connA', 'connB'], 't1'))
    expect((await checkPermission(PERMISSIONS.CONNECTION_VIEW, 'connection', 'connB'))?.status).toBe(403)
    expect(await checkPermission(PERMISSIONS.CONNECTION_VIEW, 'connection', 'connA')).toBeNull()
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.start'], ['connZ'], 't1'))
    expect((await checkPermission(PERMISSIONS.VM_START, 'vm', VM_A))?.status).toBe(403)
  })

  it('global and resource-less checks keep passing without reading the tenant connections', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.start'], null, 't1'))
    expect(await checkPermission(PERMISSIONS.VM_START)).toBeNull()
    expect(await checkPermission(PERMISSIONS.VM_START, 'global')).toBeNull()
    expect(m.getTenantConnectionIds).not.toHaveBeenCalled()
  })

  it('an unresolvable connection segment stays refused', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.start'], null, 't1'))
    expect((await checkPermission(PERMISSIONS.VM_START, 'vm', ':n1:qemu:100'))?.status).toBe(403)
  })

  it('a default tenant token is unchanged: no tenant lookup, any connection', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.start'], null, 'default'))
    expect(await checkPermission(PERMISSIONS.VM_START, 'vm', VM_B)).toBeNull()
    expect(m.getTenantConnectionIds).not.toHaveBeenCalled()
  })

  it('a tenant connection lookup that throws is a 503, never a thrown 500 nor a pass', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.start'], null, 't1'))
    m.getTenantConnectionIds.mockRejectedValue(new Error('db down: secret'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await errorOf(await checkPermission(PERMISSIONS.VM_START, 'vm', VM_A))).toEqual({ status: 503, error: 'Unable to verify token scope' })
    expect((await checkPermissions([PERMISSIONS.VM_START, PERMISSIONS.VM_START], 'vm', VM_A))?.status).toBe(503)
    errSpy.mockRestore()
  })

  it('a missing right is refused before any tenant lookup', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(['vm.view'], null, 't1'))
    expect((await checkPermission(PERMISSIONS.VM_START, 'vm', VM_A))?.status).toBe(403)
    expect(m.getTenantConnectionIds).not.toHaveBeenCalled()
  })
})

describe('vms:write scope against the permission hierarchy', () => {
  it('reaches vm.config.hardware through vm.config, never the NIC mac or vlan', async () => {
    m.getPrincipal.mockResolvedValue(tokenPrincipal(expandScopes(['vms:write'])))
    expect(await checkPermission(PERMISSIONS.VM_CONFIG_HARDWARE, 'vm', VM)).toBeNull()
    expect(await errorOf(await checkPermission(PERMISSIONS.VM_CONFIG_NIC_MAC, 'vm', VM))).toEqual({ status: 403, error: 'Permission denied: vm.config.nic.mac' })
    expect(await errorOf(await checkPermission(PERMISSIONS.VM_CONFIG_NIC_VLAN, 'vm', VM))).toEqual({ status: 403, error: 'Permission denied: vm.config.nic.vlan' })
  })
})

describe('connection scope: the connection id, never a bare prefix of another one', () => {
  // conn-a is a prefix of conn-ab: a grant on the first must not open the second.
  beforeEach(() => {
    grantRole(['vm.view', 'node.view', 'connection.view'], 'connection', 'conn-a')
    m.getTenantConnectionIds.mockResolvedValue(new Set(['conn-a', 'conn-ab']))
  })
  const has = (permission: string, resourceType: any, resourceId: string) =>
    hasPermission({ userId: 'u1', tenantId: 't1', permission, resourceType, resourceId })

  it('opens the connection itself and what sits under it', async () => {
    expect(await has(PERMISSIONS.CONNECTION_VIEW, 'connection', 'conn-a')).toBe(true)
    expect(await has(PERMISSIONS.NODE_VIEW, 'node', 'conn-a:pve1')).toBe(true)
    expect(await has(PERMISSIONS.VM_VIEW, 'vm', 'conn-a:pve1:qemu:100')).toBe(true)
  })

  it('never opens a connection whose id merely starts with it', async () => {
    expect(await has(PERMISSIONS.CONNECTION_VIEW, 'connection', 'conn-ab')).toBe(false)
    expect(await has(PERMISSIONS.NODE_VIEW, 'node', 'conn-ab:pve1')).toBe(false)
    expect(await has(PERMISSIONS.VM_VIEW, 'vm', 'conn-ab:pve1:qemu:100')).toBe(false)
  })

  it('checkPermission of a session draws the same line', async () => {
    m.getPrincipal.mockResolvedValue(userPrincipal)
    expect(await checkPermission(PERMISSIONS.VM_VIEW, 'vm', 'conn-a:pve1:qemu:100')).toBeNull()
    expect(await errorOf(await checkPermission(PERMISSIONS.VM_VIEW, 'vm', 'conn-ab:pve1:qemu:100'))).toEqual({ status: 403, error: 'Permission denied: vm.view' })
  })

  it('a connection grant without a target opens nothing', async () => {
    grantRole(['vm.view'], 'connection', null)
    expect(await has(PERMISSIONS.VM_VIEW, 'vm', 'conn-a:pve1:qemu:100')).toBe(false)
  })
})

describe('holdsBroadPermission', () => {
  it('a super admin holds everything', async () => {
    m.prisma.rbacUserRole.findFirst.mockResolvedValue({ id: 'assignment' })
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', null)).toBe(true)
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', ['c1', 'c2'])).toBe(true)
  })

  it('a pool, tag, node, vm or storage grant never counts as broad', async () => {
    for (const [scopeType, scopeTarget] of [['pool', 'prod'], ['tag', 'web'], ['node', 'c1:n1'], ['vm', 'c1:n1:qemu:100'], ['storage', 'c1:local']]) {
      grantRole(['vm.start'], scopeType, scopeTarget)
      expect(await holdsBroadPermission('u1', 't1', 'vm.start', null)).toBe(false)
      expect(await holdsBroadPermission('u1', 't1', 'vm.start', ['c1'])).toBe(false)
    }
  })

  it('a global grant covers every perimeter, through the hierarchy and with the NIC exception', async () => {
    grantRole(['vm.start', 'vm.config'])
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', null)).toBe(true)
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', ['c1', 'c2'])).toBe(true)
    expect(await holdsBroadPermission('u1', 't1', 'vm.config.hardware', null)).toBe(true)
    expect(await holdsBroadPermission('u1', 't1', 'vm.config.nic.mac', null)).toBe(false)
    expect(await holdsBroadPermission('u1', 't1', 'vm.delete', null)).toBe(false)
    expect(m.prisma.rbacUserRole.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', tenantId: 't1' }) }))
  })

  it('a connection grant covers exactly its connection', async () => {
    grantRole(['vm.start'], 'connection', 'c1')
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', ['c1'])).toBe(true)
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', ['c1', 'c2'])).toBe(false)
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', null)).toBe(false)
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', ['c10'])).toBe(false)
  })

  it('an empty perimeter needs a global grant, never vacuous truth', async () => {
    grantRole(['vm.start'], 'connection', 'c1')
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', [])).toBe(false)
    grantRole(['vm.start'])
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', [])).toBe(true)
  })

  it('global and connection grants combine across connections', async () => {
    m.prisma.rbacUserRole.findMany.mockResolvedValue([])
    m.prisma.rbacUserPermission.findMany.mockResolvedValue([
      { scopeType: 'connection', scopeTarget: 'c1', permission: { name: 'vm.start' } },
      { scopeType: 'connection', scopeTarget: 'c2', permission: { name: 'vm.start' } },
    ])
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', ['c1', 'c2'])).toBe(true)
    expect(await holdsBroadPermission('u1', 't1', 'vm.start', ['c1', 'c3'])).toBe(false)
  })
})
