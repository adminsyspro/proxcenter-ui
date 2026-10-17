import { describe, it, expect, vi, beforeEach } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { readJson } from '@/__tests__/setup/route-test'
import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', NODE_MANAGE: 'node.manage' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: vi.fn<(...args: any[]) => Promise<any>>(),
}))
// Routes resolve the node through resolveNodeSshEndpoint; keep the address
// coming from the getNodeIp mock above and the connection port (22).
vi.mock('@/lib/ssh/node-endpoint', async () => {
  const nodeIp = await import('@/lib/ssh/node-ip')
  return {
    ...(await import('@/lib/ssh/node-endpoint-core')),
    resolveNodeSshEndpoint: async (conn: any, node: string) =>
      ({ host: await nodeIp.getNodeIp(conn, node), port: 22, source: 'proxmox' }),
  }
})

const { getTenantInfrastructureScopeMock } = vi.hoisted(() => ({
  getTenantInfrastructureScopeMock: vi.fn<(...args: any[]) => Promise<any>>(),
}))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))

import { GET } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { executeSSH } from '@/lib/ssh/exec'
import { getNodeIp } from '@/lib/ssh/node-ip'
import { formatBytes as formatSize } from '@/utils/format'

const checkPermissionMock = checkPermission as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const executeSSHMock = executeSSH as any
const getNodeIpMock = getNodeIp as any

const CONN = { id: 'conn-1', name: 'Src' }
const NODE = 'pve1'
const UPID = 'UPID:pve1:0000ABCD:00001234:6A000000:qmigrate:100:root@pam:'

// Config returned for the source VM; overridden per-test to simulate a lock.
let configResult: any

function ctx(query = '') {
  return {
    req: new Request(`http://test.local/x${query}`),
    params: Promise.resolve({ connectionId: 'conn-1', node: NODE, upid: UPID }),
  }
}

// True if any pveFetch call was a source-VM destroy (DELETE / ?purge=1). This
// is exactly the call that issue #556 fired twice — it must never come from the
// task-status route now that the server-side watcher owns deletion.
function sawSourceVmDelete() {
  return pveFetchMock.mock.calls.some(
    (c: any[]) =>
      c?.[2]?.method === 'DELETE' ||
      (typeof c?.[1] === 'string' && c[1].includes('purge=')),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue(CONN)
  getNodeIpMock.mockResolvedValue('10.0.0.2')
  executeSSHMock.mockResolvedValue({ success: true })
  configResult = { name: 'vm100' } // unlocked by default
  pveFetchMock.mockImplementation((_conn: any, path: string) => {
    if (typeof path === 'string') {
      if (path.includes('/status')) {
        return Promise.resolve({
          status: 'stopped',
          exitstatus: 'OK',
          type: 'qmigrate',
          id: '100',
          starttime: 1000,
          endtime: 1050,
        })
      }
      if (path.includes('/log')) return Promise.resolve([])
      if (path.includes('/config')) return Promise.resolve(configResult)
    }
    return Promise.resolve(undefined)
  })
})

describe('GET /api/v1/tasks/[connectionId]/[node]/[upid] — source-VM cleanup (#556)', () => {
  it('never issues a source-VM delete after a successful cross-cluster migration', async () => {
    const { req, params } = ctx()
    const res = await GET(req, { params })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.message).toBe('Completed successfully')
    expect(sawSourceVmDelete()).toBe(false)
  })

  it('ignores a legacy ?deleteSource=true query and still issues no delete', async () => {
    // The client no longer sends this param; guard against reintroducing the
    // double-destroy if some caller adds it back.
    const { req, params } = ctx('?deleteSource=true')
    const res = await GET(req, { params })

    expect(res.status).toBe(200)
    expect(sawSourceVmDelete()).toBe(false)
  })

  it('unlocks a locked source VM via SSH but never deletes it', async () => {
    configResult = { name: 'vm100', lock: 'migrate' }
    const { req, params } = ctx()
    const res = await GET(req, { params })

    expect(res.status).toBe(200)
    expect(executeSSHMock).toHaveBeenCalledWith('conn-1', expect.objectContaining({ host: '10.0.0.2' }), 'qm unlock 100')
    expect(sawSourceVmDelete()).toBe(false)
  })

  it('does not delete when the migration finished with problems but completed', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (typeof path === 'string') {
        if (path.includes('/status')) {
          return Promise.resolve({
            status: 'stopped',
            exitstatus: 'migration problems',
            type: 'qmigrate',
            id: '100',
            starttime: 1000,
            endtime: 1050,
          })
        }
        if (path.includes('/log')) return Promise.resolve([{ n: 1, t: 'migration status: completed' }])
        if (path.includes('/config')) return Promise.resolve({ name: 'vm100' })
      }
      return Promise.resolve(undefined)
    })

    const { req, params } = ctx()
    const res = await GET(req, { params })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.message).toMatch(/Migration completed \(with cleanup warnings\)/)
    expect(sawSourceVmDelete()).toBe(false)
  })

  it('handles an intra-cluster migration where PVE already removed the source config', async () => {
    // Reading the source config 500s with "Configuration file ... does not
    // exist" — detected and handled silently (no unlock, no delete).
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (typeof path === 'string') {
        if (path.includes('/status')) {
          return Promise.resolve({ status: 'stopped', exitstatus: 'OK', type: 'qmigrate', id: '100', starttime: 1000, endtime: 1050 })
        }
        if (path.includes('/log')) return Promise.resolve([])
        if (path.includes('/config')) {
          return Promise.reject(new Error("Configuration file 'nodes/pve1/qemu-server/100.conf' does not exist"))
        }
      }
      return Promise.resolve(undefined)
    })

    const { req, params } = ctx()
    const res = await GET(req, { params })

    expect(res.status).toBe(200)
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(sawSourceVmDelete()).toBe(false)
  })

  it('skips cleanup when the task id is not a valid vmid', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (typeof path === 'string') {
        if (path.includes('/status')) {
          return Promise.resolve({ status: 'stopped', exitstatus: 'OK', type: 'qmigrate', id: 'not-a-vmid', starttime: 1000, endtime: 1050 })
        }
        if (path.includes('/log')) return Promise.resolve([])
        if (path.includes('/config')) return Promise.resolve({ name: 'vm' })
      }
      return Promise.resolve(undefined)
    })

    const { req, params } = ctx()
    const res = await GET(req, { params })

    expect(res.status).toBe(200)
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(sawSourceVmDelete()).toBe(false)
  })

  it('tolerates a source-VM config read error without deleting', async () => {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (typeof path === 'string') {
        if (path.includes('/status')) {
          return Promise.resolve({ status: 'stopped', exitstatus: 'OK', type: 'qmigrate', id: '100', starttime: 1000, endtime: 1050 })
        }
        if (path.includes('/log')) return Promise.resolve([])
        if (path.includes('/config')) return Promise.reject(new Error('PVE 500 internal error'))
      }
      return Promise.resolve(undefined)
    })

    const { req, params } = ctx()
    const res = await GET(req, { params })

    expect(res.status).toBe(200)
    expect(sawSourceVmDelete()).toBe(false)
  })

  it('attempts to unlock a locked source VM even when SSH unlock fails, and never deletes', async () => {
    configResult = { name: 'vm100', lock: 'migrate' }
    executeSSHMock.mockResolvedValue({ success: false, error: 'ssh denied' })

    const { req, params } = ctx()
    const res = await GET(req, { params })

    expect(res.status).toBe(200)
    expect(executeSSHMock).toHaveBeenCalledWith('conn-1', expect.objectContaining({ host: '10.0.0.2' }), 'qm unlock 100')
    expect(sawSourceVmDelete()).toBe(false)
  })
})

describe('GET /api/v1/tasks/[connectionId]/[node]/[upid] — progress of a running task', () => {
  const GiB = 1024 ** 3

  function runningTask(type: string, lines: string[]) {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (typeof path === 'string') {
        if (path.includes('/status')) {
          return Promise.resolve({ status: 'running', type, id: '100', starttime: 1000 })
        }
        if (path.includes('/log')) return Promise.resolve(lines.map((t, i) => ({ n: i + 1, t })))
      }
      return Promise.resolve(undefined)
    })
  }

  async function progressOf(type: string, lines: string[]) {
    runningTask(type, lines)
    const { req, params } = ctx()
    const res = await GET(req, { params })
    expect(res.status).toBe(200)
    return readJson<any>(res)
  }

  describe('migration logs', () => {
    it('parses an online NBD disk transfer line into progress, speed and ETA', async () => {
      const body = await progressOf('qmigrate', [
        "2026-01-23 15:42:29 starting migration of VM 100 to node 'pve2' (10.0.0.3)",
        '2026-01-23 15:42:30 starting storage migration',
        'drive-scsi0: transferred 2.0 GiB of 8.0 GiB (25.00%) in 10s',
      ])

      // 25 % of the bytes, scaled to 95 % to leave room for finalisation
      expect(body.progress).toBe(23.8)
      // 2 GiB in 10 s
      expect(body.speed).toBe('204.8 MiB/s')
      // 6 GiB left at 204.8 MiB/s
      expect(body.eta).toBe('30s')
      expect(body.message).toBe(`Transfer: ${formatSize(2 * GiB)} / ${formatSize(8 * GiB)}`)
    })

    it('parses the live RAM phase from a "migration active" line', async () => {
      const body = await progressOf('qmigrate', [
        '2026-01-23 15:43:00 starting online/live migration on unix:/run/qemu-server/100.migrate',
        '2026-01-23 15:43:01 migration active, transferred 512.0 MiB of 4.0 GiB VM-state, 100.0 MiB/s',
      ])

      expect(body.progress).toBe(11.9)
      expect(body.speed).toBe('100.0 MiB/s')
      expect(body.eta).toBe('36s')
      expect(body.message).toBe(`Transfer: ${formatSize(512 * 1024 ** 2)} / ${formatSize(4 * GiB)}`)
    })

    it('tracks an offline zfs send through its estimate and per-second progress lines', async () => {
      const body = await progressOf('qmigrate', [
        '2026-01-23 16:00:00 starting remote migration of VM 100',
        'full send of rpool/data/vm-100-disk-0@__migration__ estimated size is 10.0G',
        '12:00:01 2.5G rpool/data/vm-100-disk-0@__migration__',
      ])

      expect(body.progress).toBe(23.8)
      expect(body.speed).toBe('')
      expect(body.eta).toBe('')
      expect(body.message).toBe(`Transfer: ${formatSize(2.5 * GiB)} / ${formatSize(10 * GiB)}`)
    })

    it('reports 100 % once PVE logs the successful end', async () => {
      const body = await progressOf('qmigrate', [
        'drive-scsi0: transferred 8.0 GiB of 8.0 GiB (100.00%) in 40s',
        '2026-01-23 15:44:00 migration finished successfully (duration 00:01:31)',
      ])

      expect(body.progress).toBe(100)
      expect(body.message).toBe('Migration completed successfully')
    })
  })

  describe('generic task logs', () => {
    it('parses a wget-style download line into percent, speed and ETA', async () => {
      const body = await progressOf('download', [
        'downloading https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2 to /var/lib/vz/template/iso/debian-12.img',
        '     0K ........ ........ ........ ........  0% 1.10M 9m30s',
        ' 51200K ........ ........ ........ ........  5% 2.22M 4m16s',
      ])

      expect(body.progress).toBe(5)
      expect(body.speed).toBe('2.22 MiB/s')
      expect(body.eta).toBe('4m16s')
      expect(body.message).toBe('')
    })

    it('parses a "transferred X of Y (N%)" line and a plain speed line', async () => {
      const body = await progressOf('qmmove', [
        'create full clone of drive scsi0 (local-lvm:vm-100-disk-0)',
        'transferred 1.0 GiB of 4.0 GiB (25.00%)',
        'average rate 110.5 MiB/s',
      ])

      expect(body.progress).toBe(25)
      expect(body.message).toBe('Transfer: 1.0 GiB / 4.0 GiB')
      expect(body.speed).toBe('110.5 MiB/s')
      expect(body.eta).toBe('')
    })

    it('keeps the highest percentage seen across the log', async () => {
      const body = await progressOf('vzdump', [
        'INFO: 40% (1.6 GiB of 4.0 GiB) in 10s',
        'INFO: 12.5% stale line',
      ])

      expect(body.progress).toBe(40)
    })

    it('returns an empty message for a task that reports no progress', async () => {
      const body = await progressOf('vncproxy', [])

      expect(body).toMatchObject({ progress: 0, message: '', speed: '', eta: '' })
    })
  })
})

describe('GET /api/v1/tasks/[connectionId]/[node]/[upid]: failure reason (#926)', () => {
  function stoppedTask(exitstatus: string, lines: string[]) {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (typeof path === 'string') {
        if (path.includes('/status')) {
          return Promise.resolve({ status: 'stopped', exitstatus, type: 'qmigrate', id: '100', starttime: 1000, endtime: 1004 })
        }
        if (path.includes('/log')) return Promise.resolve(lines.map((t, i) => ({ n: i + 1, t })))
      }
      return Promise.resolve(undefined)
    })
  }

  async function body(query = '') {
    const { req, params } = ctx(query)
    const res = await GET(req, { params })
    expect(res.status).toBe(200)
    return readJson<any>(res)
  }

  it('returns the reason Proxmox logged instead of the bare exitstatus', async () => {
    stoppedTask('migration aborted', [
      "2026-09-11 10:00:00 starting migration of VM 100 to node 'pve2' (10.42.0.102)",
      "2026-09-11 10:00:00 ERROR: Problem found while scanning volumes - can't migrate local cdrom 'local:iso/debian.iso'",
      '2026-09-11 10:00:00 aborting phase 1 - cleanup resources',
      "2026-09-11 10:00:01 ERROR: migration aborted (duration 00:00:01): Problem found while scanning volumes - can't migrate local cdrom 'local:iso/debian.iso'",
      'TASK ERROR: migration aborted',
    ])

    const json = await body()

    expect(json.exitstatus).toBe('migration aborted')
    expect(json.failureReason).toBe("Problem found while scanning volumes - can't migrate local cdrom 'local:iso/debian.iso'")
    expect(json.message).toBe(`Failed: ${json.failureReason}`)
    expect(json.logs).toHaveLength(5)
  })

  it('falls back to the exitstatus when the log says nothing', async () => {
    stoppedTask('migration aborted', [])

    const json = await body()

    expect(json.failureReason).toBe('migration aborted')
  })

  it('reads the reason of a migration that finished with problems without completing', async () => {
    stoppedTask('migration problems', [
      "2026-09-11 10:00:03 ERROR: online migrate failure - VM 100 qmp command 'migrate' failed - aborting",
      '2026-09-11 10:00:05 ERROR: migration finished with problems (duration 00:00:05)',
      'TASK ERROR: migration problems',
    ])

    expect((await body()).failureReason).toBe("online migrate failure - VM 100 qmp command 'migrate' failed - aborting")
  })

  it('has no reason for a successful task or one stopped by the user', async () => {
    expect((await body()).failureReason).toBeNull()

    stoppedTask('received interrupt', ['TASK ERROR: received interrupt'])
    expect((await body()).failureReason).toBeNull()
  })

  it('omits the log lines in summary mode but still extracts the reason', async () => {
    stoppedTask('migration aborted', ['TASK ERROR: CT is locked (backup)'])

    const json = await body('?summary=1')

    expect(json.failureReason).toBe('CT is locked (backup)')
    expect(json.logs).toEqual([])
    expect(json.totalLogLines).toBe(1)
  })
})

describe('GET /api/v1/tasks/[connectionId]/[node]/[upid]: connection and vDC perimeter', () => {
  const token = {
    kind: 'token', tokenId: 'tok-1', tenantId: 'tenant-v', creatorUserId: 'u1',
    connectionIds: null, scopes: ['vms:power'], permissions: new Set(['vm.view', 'connection.view']),
  }
  const DESTROY_UPID = 'UPID:pve1:0000ABCD:00001234:6A000000:qmdestroy:100:root@pam:'

  function tenantGuests(rows: unknown[]) {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {
      connectionIds: new Set(['conn-1']),
      nodesByConnection: new Map([['conn-1', new Set(['pve1', 'pve2'])]]),
      poolsByConnection: new Map([['conn-1', new Set(['pool-a'])]]),
    } })
    const statusFetch = pveFetchMock.getMockImplementation()
    pveFetchMock.mockImplementation((conn: any, path: string, ...rest: any[]) =>
      path === '/cluster/resources?type=vm' ? Promise.resolve(rows) : statusFetch?.(conn, path, ...rest))
  }

  function tokenGet(upid: string, principal: Record<string, unknown> = token, node = NODE) {
    return GET(new Request('http://test.local/x'), {
      params: Promise.resolve({ connectionId: 'conn-1', node, upid }),
      principal: principal as any,
    })
  }

  function askedProxmoxForTheTask() {
    return pveFetchMock.mock.calls.some((c: any[]) => String(c[1]).includes('/tasks/'))
  }

  async function journalTokenWrite(apiTokenId: string, upid: string) {
    await prismaTest.auditLog.create({ data: {
      id: `audit-${apiTokenId}-${upid.length}`, tenantId: 'tenant-v', timestamp: new Date(), action: 'apitoken.write',
      category: 'api_tokens', apiTokenId, details: { entry: 'vm-delete', upid },
    } })
  }

  it('judges a token on the connection of the task', async () => {
    await tokenGet(UPID)
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.view', 'connection', 'conn-1')
  })

  it('keeps the resource-less check for sessions, so a narrowly scoped user still polls', async () => {
    // scopeMatches: a vm-scoped grant matches a resource-less check, never a "connection" resource.
    checkPermissionMock.mockImplementation(async (_perm: string, resourceType?: string) =>
      resourceType ? Response.json({ error: 'Permission denied: connection.view' }, { status: 403 }) : null)
    const { req, params } = ctx()
    const res = await GET(req, { params })
    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.view')
  })

  it('a vDC tenant token reads the task of one of its guests, checked on the task node', async () => {
    tenantGuests([{ type: 'qemu', vmid: 100, node: 'pve1', pool: 'pool-a' }])
    const res = await tokenGet(UPID)
    expect(res.status).toBe(200)
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith('tenant-v', { ignoreVdcContext: true })
  })

  it('a vDC tenant token is refused the task of a guest outside its vDC, before Proxmox is asked for it', async () => {
    tenantGuests([
      { type: 'qemu', vmid: 100, node: 'pve1', pool: 'pool-other' },
      { type: 'qemu', vmid: 200, node: 'pve1', pool: 'pool-a' },
    ])
    const res = await tokenGet(UPID)
    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toEqual({ error: 'Task outside your vDC scope' })
    expect(askedProxmoxForTheTask()).toBe(false)
  })

  it('a vDC tenant token is refused a UPID whose node is not the URL node', async () => {
    tenantGuests([{ type: 'qemu', vmid: 100, node: 'pve1', pool: 'pool-a' }])
    const res = await tokenGet(UPID, token, 'pve2')
    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toEqual({ error: 'Task outside your vDC scope' })
  })

  it('a vDC tenant token is refused a task that names no guest', async () => {
    tenantGuests([{ type: 'qemu', vmid: 100, node: 'pve1', pool: 'pool-a' }])
    const res = await tokenGet('UPID:pve1:0000ABCD:00001234:6A000000:aptupdate::root@pam:')
    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toEqual({ error: 'Task outside your vDC scope' })
  })

  it('a vDC tenant token fails closed (503) when its guests cannot be listed or its scope resolved', async () => {
    tenantGuests([])
    pveFetchMock.mockImplementation(() => Promise.reject(new Error('pve down')))
    expect((await tokenGet(UPID)).status).toBe(503)
    getTenantInfrastructureScopeMock.mockRejectedValue(new Error('db down'))
    expect((await tokenGet(UPID)).status).toBe(503)
  })

  describe('a task the token started itself', () => {
    beforeEach(async () => {
      await truncate(['audit_logs'])
      tenantGuests([])
      await journalTokenWrite('tok-1', DESTROY_UPID)
    })

    it('reads the final status of its own vm-delete whose guest no longer exists', async () => {
      const res = await tokenGet(DESTROY_UPID)
      expect(res.status).toBe(200)
    })

    it('another token of the same tenant is refused the same UPID', async () => {
      const res = await tokenGet(DESTROY_UPID, { ...token, tokenId: 'tok-2' })
      expect(res.status).toBe(403)
      expect(askedProxmoxForTheTask()).toBe(false)
    })
  })

  it('provider tokens and sessions are not confined to vDC guests', async () => {
    expect((await tokenGet(UPID)).status).toBe(200)
    const { req, params } = ctx()
    expect((await GET(req, { params })).status).toBe(200)
    expect(pveFetchMock.mock.calls.some((c: any[]) => c[1] === '/cluster/resources?type=vm')).toBe(false)
  })

  it('a token without vms:migrate never releases the source lock of a finished migration', async () => {
    configResult = { name: 'vm100', lock: 'migrate' }
    expect((await tokenGet(UPID)).status).toBe(200)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('a token with vms:migrate releases it, as a session does', async () => {
    configResult = { name: 'vm100', lock: 'migrate' }
    expect((await tokenGet(UPID, { ...token, scopes: ['vms:migrate'] })).status).toBe(200)
    expect(executeSSHMock).toHaveBeenCalledWith('conn-1', expect.objectContaining({ host: '10.0.0.2' }), 'qm unlock 100')
  })
})
