/**
 * Session callers of GET /api/v1/tasks/{connectionId}/{node}/{upid} follow a
 * task when they may view its connection, or the guest its UPID names, or its
 * node: a vm-, pool- or node-scoped user still polls the tasks of what it can
 * see (#378 class), a grant elsewhere opens nothing. Real route and real RBAC
 * grant matching (scopeMatches, pool pass 2); the session, the grant rows,
 * the VM metadata index and Proxmox are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getPrincipal: vi.fn<(...a: any[]) => Promise<any>>(),
  resolveVmMeta: vi.fn<(...a: any[]) => any>(),
  findVmMetaByVmid: vi.fn<(...a: any[]) => any>(),
  getConnectionById: vi.fn<(...a: any[]) => Promise<any>>(),
  pveFetch: vi.fn<(...a: any[]) => Promise<any>>(),
  roleGrants: [] as any[],
}))

vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))
vi.mock('@/lib/auth/principal', async io => ({
  ...await io<typeof import('@/lib/auth/principal')>(),
  getPrincipal: (...a: any[]) => m.getPrincipal(...a),
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacUserRole: { findFirst: async () => null, findMany: async () => m.roleGrants },
    rbacUserPermission: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/cache/vmMetaCache', () => ({
  resolveVmMeta: (...a: any[]) => m.resolveVmMeta(...a),
  findVmMetaByVmid: (...a: any[]) => m.findVmMetaByVmid(...a),
}))
vi.mock('@/lib/cache/inventoryCache', () => ({ getTenantInventoriesFromCache: () => [] }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getTenantConnectionIds: async () => new Set(['conn-1', 'conn-2']) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: any[]) => m.getConnectionById(...a) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => m.pveFetch(...a) }))

import { GET } from './route'

const upid = (type: string, id: string, node = 'pve1') => `UPID:${node}:0000ABCD:00001234:6A000000:${type}:${id}:root@pam:`

/** One role holding the given permissions on one scope. */
function grant(permissions: string[], scopeType: string, scopeTarget: string | null) {
  m.roleGrants = [{ scopeType, scopeTarget, role: { defaultScopes: null, permissions: permissions.map(name => ({ permission: { name } })) } }]
}

function poll(taskUpid: string, connectionId = 'conn-1', node = 'pve1') {
  return GET(new Request('http://test.local/x?summary=1'), { params: Promise.resolve({ connectionId, node, upid: taskUpid }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.roleGrants = []
  m.getPrincipal.mockResolvedValue({ ok: true, principal: { kind: 'session', userId: 'u1', tenantId: 'default', connectionIds: null } })
  m.resolveVmMeta.mockReturnValue(null)
  m.findVmMetaByVmid.mockReturnValue(null)
  m.getConnectionById.mockImplementation(async (id: string) => ({ id, name: id }))
  m.pveFetch.mockImplementation(async (_c: any, path: string) =>
    path.endsWith('/status') ? { status: 'stopped', exitstatus: 'OK', type: 'qmstart', id: '100' } : [])
})

// The view rights of the system roles (role_vm_user, role_viewer...), here held on one narrow scope.
const VIEWER = ['vm.view', 'node.view', 'connection.view']

describe('task status for a session', () => {
  it('a vm-scoped user polls the task of its VM', async () => {
    grant(VIEWER, 'vm', 'conn-1:pve1:qemu:100')
    expect((await poll(upid('qmstart', '100'))).status).toBe(200)
  })

  it('a vm-scoped user polls the task of its container (vz* task)', async () => {
    grant(VIEWER, 'vm', 'conn-1:pve1:lxc:200')
    expect((await poll(upid('vzstart', '200'))).status).toBe(200)
  })

  it('a vm-scoped user polls the vzdump of its container (type tried as qemu, then lxc)', async () => {
    grant(VIEWER, 'vm', 'conn-1:pve1:lxc:200')
    expect((await poll(upid('vzdump', '200'))).status).toBe(200)
  })

  it('a qm* task never matches a container grant of the same vmid', async () => {
    grant(VIEWER, 'vm', 'conn-1:pve1:lxc:100')
    expect((await poll(upid('qmstart', '100'))).status).toBe(403)
  })

  it('the same vm-scoped user is refused the task of another VM, before Proxmox is asked', async () => {
    grant(VIEWER, 'vm', 'conn-1:pve1:qemu:100')

    const res = await poll(upid('qmstart', '101'))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Permission denied: connection.view' })
    expect(m.pveFetch).not.toHaveBeenCalled()
  })

  it('a vm grant does not open the task when the UPID names another node than the URL', async () => {
    grant(VIEWER, 'vm', 'conn-1:pve1:qemu:100')
    expect((await poll(upid('qmstart', '100', 'pve2'))).status).toBe(403)
  })

  it('a user whose grants are all on another connection is refused', async () => {
    grant(VIEWER, 'connection', 'conn-2')
    expect((await poll(upid('qmstart', '100'))).status).toBe(403)
    expect((await poll(upid('aptupdate', ''))).status).toBe(403)
  })

  it('a connection-scoped user polls any task of that connection, guest or not', async () => {
    grant(VIEWER, 'connection', 'conn-1')
    expect((await poll(upid('qmstart', '100'))).status).toBe(200)
    expect((await poll(upid('srvreload', 'networking'))).status).toBe(200)
  })

  it('a pool-scoped user polls the task of a VM of its pool (pass 2 on the VM metadata)', async () => {
    grant(VIEWER, 'pool', 'pool-a')
    m.resolveVmMeta.mockImplementation((rid: string) => rid === 'conn-1:pve1:qemu:100' ? { tags: [], pool: 'pool-a' } : { tags: [], pool: 'pool-b' })

    expect((await poll(upid('qmstart', '100'))).status).toBe(200)
    expect(m.resolveVmMeta).toHaveBeenCalledWith('conn-1:pve1:qemu:100', 'default')
    expect((await poll(upid('qmstart', '101'))).status).toBe(403)
  })

  describe('a guest that moved since its task ran (migration, DRS or HA relocation)', () => {
    // The UPID names pve1, where the task ran and is read; the inventory has the VM on pve2 now.
    beforeEach(() => {
      m.findVmMetaByVmid.mockImplementation((conn: string, vmid: string) =>
        conn === 'conn-1' && vmid === '100' ? { tags: [], pool: 'pool-a', node: 'pve2' } : null)
    })

    it('a pool-scoped user still polls it: judged where the VM lives now', async () => {
      grant(VIEWER, 'pool', 'pool-a')
      m.resolveVmMeta.mockImplementation((rid: string) => rid === 'conn-1:pve2:qemu:100' ? { tags: [], pool: 'pool-a' } : null)

      expect((await poll(upid('qmstart', '100'))).status).toBe(200)
      expect(m.findVmMetaByVmid).toHaveBeenCalledWith('conn-1', '100', 'default')
    })

    it('a vm-scoped user whose grant names the current node still polls it', async () => {
      grant(VIEWER, 'vm', 'conn-1:pve2:qemu:100')
      expect((await poll(upid('qmstart', '100'))).status).toBe(200)
    })

    it('the current node opens nothing more than the guest itself: another VM stays refused', async () => {
      grant(VIEWER, 'vm', 'conn-1:pve2:qemu:100')
      expect((await poll(upid('qmstart', '101'))).status).toBe(403)
    })

    it('no inventory lookup when the grant already matches on the UPID node', async () => {
      grant(VIEWER, 'vm', 'conn-1:pve1:qemu:100')
      expect((await poll(upid('qmstart', '100'))).status).toBe(200)
      expect(m.findVmMetaByVmid).not.toHaveBeenCalled()
    })
  })

  it('a node-scoped user polls a node task of its node, not of another node', async () => {
    grant(VIEWER, 'node', 'conn-1:pve1')
    expect((await poll(upid('aptupdate', ''))).status).toBe(200)
    expect((await poll(upid('aptupdate', '', 'pve2'), 'conn-1', 'pve2')).status).toBe(403)
  })

  it('a vm.view grant on the VM alone is enough', async () => {
    grant(['vm.view'], 'vm', 'conn-1:pve1:qemu:100')
    expect((await poll(upid('qmstart', '100'))).status).toBe(200)
  })

  it('an unauthenticated caller gets the 401, not a fallback check', async () => {
    m.getPrincipal.mockResolvedValue({ ok: true })
    expect((await poll(upid('qmstart', '100'))).status).toBe(401)
  })
})
