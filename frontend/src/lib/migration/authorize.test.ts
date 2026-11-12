// roadmap#184: vm.migrate is checked on the resources a migration touches,
// not only "held somewhere".
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  checkPermission: vi.fn(),
  infraScope: vi.fn(),
  tenantScope: vi.fn(),
  canMigrate: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: h.checkPermission,
  getCurrentRbacInfraScope: h.infraScope,
  PERMISSIONS: { VM_MIGRATE: 'vm.migrate', CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...a: unknown[]) => h.tenantScope(...a),
  canMigrateConnections: (...a: unknown[]) => h.canMigrate(...a),
}))
vi.mock('@/lib/rbac/nicPermissions', () => ({ sensitiveNicPermissions: () => [] }))

import { authorizeMigrationNode, authorizeMigrationTarget, denyMigrationEnds, mayMigrateBetweenClusters, migrateScope, scopedJobWhere } from './authorize'
import type { RbacInfraScope } from '@/lib/rbac/infraScope'

const scope = (over: Partial<RbacInfraScope> = {}): RbacInfraScope => ({
  fullConnections: new Set(['vc', 'dr']),
  nodesByConnection: new Map([['prod', new Set(['pve2'])]]),
  nodeGrantsByConnection: new Map([['prod', new Set(['pve2'])]]),
  guestDerived: false,
  ...over,
})

beforeEach(() => {
  h.granted = new Set(['connection:vc', 'node:dr:pve1-dr', 'node:prod:pve2'])
  h.checkPermission.mockReset().mockImplementation(async (_perm: string, type: string, id: string) =>
    h.granted.has(`${type}:${id}`) ? null : new Response(null, { status: 403 }))
  h.infraScope.mockReset().mockResolvedValue(null)
  h.tenantScope.mockReset().mockResolvedValue({ kind: 'provider' })
  h.canMigrate.mockReset().mockReturnValue(true)
})

describe('denyMigrationEnds', () => {
  it('lets through a migration from a granted source to a granted target node', async () => {
    expect(await denyMigrationEnds('vc', 'dr', ['pve1-dr'])).toBeNull()
    expect(h.checkPermission).toHaveBeenCalledWith('vm.migrate', 'connection', 'vc')
    expect(h.checkPermission).toHaveBeenCalledWith('vm.migrate', 'node', 'dr:pve1-dr')
  })

  it('refuses a source connection the caller holds no grant on', async () => {
    expect((await denyMigrationEnds('esxi', 'dr', ['pve1-dr']))?.status).toBe(403)
  })

  it('refuses as soon as one target node is not granted, and checks each node once', async () => {
    expect((await denyMigrationEnds('vc', 'prod', ['pve2', 'pve1', 'pve2']))?.status).toBe(403)
    expect(h.checkPermission.mock.calls.filter(c => c[2] === 'prod:pve2')).toHaveLength(1)
  })

  it('checks only the target when no source is given', async () => {
    expect(await denyMigrationEnds(undefined, 'prod', ['pve2'])).toBeNull()
    expect(h.checkPermission).toHaveBeenCalledTimes(1)
  })
})

describe('authorizeMigrationTarget', () => {
  it('refuses a target node outside the grants before any NIC check', async () => {
    const res = await authorizeMigrationTarget({ tenantId: 'default', sourceConnectionId: 'vc', targetConnectionId: 'prod', targetNode: 'pve1', networkBridge: 'vmbr0' })

    expect(res?.status).toBe(403)
  })

  it('accepts a granted target node', async () => {
    expect(await authorizeMigrationTarget({ tenantId: 'default', sourceConnectionId: 'vc', targetConnectionId: 'prod', targetNode: 'pve2', networkBridge: 'vmbr0' })).toBeNull()
  })
})

describe('authorizeMigrationNode', () => {
  // roadmap#224: the routes that run commands on a target node for a
  // migration (preflight, "Prepare this node") share one gate.
  it('lets a tenant that may migrate to the cluster through, with vm.migrate on the node', async () => {
    expect(await authorizeMigrationNode({ tenantId: 'default', targetConnectionId: 'prod', targetNode: 'pve2' })).toBeNull()
    expect(h.tenantScope).toHaveBeenCalledWith('default')
    expect(h.canMigrate).toHaveBeenCalledWith({ kind: 'provider' }, 'prod')
    expect(h.checkPermission).toHaveBeenCalledWith('vm.migrate', 'node', 'prod:pve2')
  })

  it('answers 404 to a tenant that may not migrate to the cluster, before any permission check', async () => {
    h.tenantScope.mockResolvedValue({ kind: 'iaas' })
    h.canMigrate.mockReturnValue(false)

    const res = await authorizeMigrationNode({ tenantId: 'vdc-tenant', targetConnectionId: 'prod', targetNode: 'pve2' })

    expect(res?.status).toBe(404)
    expect(await res?.json()).toEqual({ error: 'Connection not found' })
    expect(h.tenantScope).toHaveBeenCalledWith('vdc-tenant')
    expect(h.checkPermission).not.toHaveBeenCalled()
  })

  it('weighs the source connection too when one is given', async () => {
    expect(await authorizeMigrationNode({ tenantId: 'default', sourceConnectionId: 'vc', targetConnectionId: 'prod', targetNode: 'pve2' })).toBeNull()
    expect(h.canMigrate).toHaveBeenCalledWith({ kind: 'provider' }, 'prod', 'vc')
    expect(h.checkPermission).toHaveBeenCalledWith('vm.migrate', 'connection', 'vc')
  })

  it('refuses a target node outside the vm.migrate grants', async () => {
    expect((await authorizeMigrationNode({ tenantId: 'default', targetConnectionId: 'prod', targetNode: 'pve1' }))?.status).toBe(403)
  })
})

describe('scopedJobWhere', () => {
  it('returns the where untouched for an unrestricted caller', () => {
    const where = { id: 'j1' }

    expect(scopedJobWhere(where, null)).toBe(where)
  })

  it('keeps the jobs from a granted source to a granted cluster or node', () => {
    expect(scopedJobWhere({ id: 'j1' }, scope())).toEqual({
      AND: [{ id: 'j1' }, {
        sourceConnectionId: { in: ['vc', 'dr'] },
        OR: [
          { targetConnectionId: { in: ['vc', 'dr'] } },
          { targetConnectionId: 'prod', targetNode: { in: ['pve2'] } },
        ],
      }],
    })
  })

  it('falls back to the tree nodes on a scope built without outright node grants', () => {
    const where = scopedJobWhere({}, scope({ nodeGrantsByConnection: undefined, nodesByConnection: new Map([['prod', new Set(['pve3'])]]) })) as any

    expect(where.AND[1].OR[1]).toEqual({ targetConnectionId: 'prod', targetNode: { in: ['pve3'] } })
  })
})

describe('mayMigrateBetweenClusters', () => {
  it('needs both clusters granted whole', () => {
    expect(mayMigrateBetweenClusters(null, 'vc', 'prod')).toBe(true)
    expect(mayMigrateBetweenClusters(scope(), 'vc', 'dr')).toBe(true)
    expect(mayMigrateBetweenClusters(scope(), 'vc', 'prod')).toBe(false)
  })
})

describe('migrateScope', () => {
  it('reads the vm.migrate perimeter', async () => {
    await migrateScope()

    expect(h.infraScope).toHaveBeenCalledWith('vm.migrate')
  })
})
