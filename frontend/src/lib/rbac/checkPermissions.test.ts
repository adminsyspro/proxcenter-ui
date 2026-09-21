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
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))

import { checkPermissions, expandPermissionHierarchy, PERMISSIONS } from './index'

const VM = 'conn-1:pve1:qemu:100'

const tokenPrincipal = (permissions: string[], connectionIds: string[] | undefined = ['conn-1']) => ({
  ok: true,
  principal: { kind: 'token', tokenId: 'tok_x', tenantId: 'default', permissions: new Set(permissions), connectionIds },
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
