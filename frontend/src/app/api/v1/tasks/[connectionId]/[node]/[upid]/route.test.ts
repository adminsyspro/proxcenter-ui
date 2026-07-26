import { describe, it, expect, vi, beforeEach } from 'vitest'

import { readJson } from '@/__tests__/setup/route-test'

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

import { GET } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { executeSSH } from '@/lib/ssh/exec'
import { getNodeIp } from '@/lib/ssh/node-ip'

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
    expect(executeSSHMock).toHaveBeenCalledWith('conn-1', '10.0.0.2', 'qm unlock 100')
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
    expect(executeSSHMock).toHaveBeenCalledWith('conn-1', '10.0.0.2', 'qm unlock 100')
    expect(sawSourceVmDelete()).toBe(false)
  })
})
