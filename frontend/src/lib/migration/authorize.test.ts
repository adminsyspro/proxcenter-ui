// roadmap#184: vm.migrate is checked on the resources a migration touches,
// not only "held somewhere".
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  checkPermission: vi.fn(),
  infraScope: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: h.checkPermission,
  getCurrentRbacInfraScope: h.infraScope,
  PERMISSIONS: { VM_MIGRATE: 'vm.migrate', CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: async () => ({ kind: 'provider' }),
  canMigrateConnections: () => true,
}))
vi.mock('@/lib/rbac/nicPermissions', () => ({ sensitiveNicPermissions: () => [] }))

import { authorizeMigrationTarget, denyMigrationEnds, mayMigrateBetweenClusters, migrateScope, scopedJobWhere } from './authorize'
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
