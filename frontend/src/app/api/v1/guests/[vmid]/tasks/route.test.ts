import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { GET } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

const VM_KEY = 'conn-1:qemu:pve-node-01:101'
const LXC_VM_KEY = 'conn-1:lxc:pve-node-01:200'

beforeEach(() => {
  vi.clearAllMocks()
  getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
})

describe('GET /api/v1/guests/[vmid]/tasks', () => {
  it('returns formatted tasks sorted by starttime descending', async () => {
    pveFetchMock.mockResolvedValue([
      { upid: 'upid1', type: 'vzdump', status: 'OK', starttime: 1000, endtime: 1060, user: 'root@pam', node: 'pve-node-01' },
      { upid: 'upid2', type: 'qmstart', status: 'OK', starttime: 2000, endtime: 2010, user: 'root@pam', node: 'pve-node-01' },
    ])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.count).toBe(2)
    // sorted descending by starttime
    expect(body.data.tasks[0].upid).toBe('upid2')
    expect(body.data.tasks[1].upid).toBe('upid1')
    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: 'conn-1' },
      '/nodes/pve-node-01/tasks?vmid=101&limit=50',
    )
  })

  it('maps OK status to success', async () => {
    pveFetchMock.mockResolvedValue([
      { upid: 'u1', type: 'qmstart', status: 'OK', starttime: 1000, endtime: 1065, user: 'root@pam', node: 'pve-node-01' },
    ])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    const body = await readJson<any>(res)
    expect(body.data.tasks[0].status).toBe('success')
  })

  it('maps WARNINGS status to warning', async () => {
    pveFetchMock.mockResolvedValue([
      { upid: 'u1', type: 'qmstart', status: 'WARNINGS: something', starttime: 1000, endtime: 1070, user: 'root@pam', node: 'pve-node-01' },
    ])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    const body = await readJson<any>(res)
    expect(body.data.tasks[0].status).toBe('warning')
  })

  it('maps unknown status to error', async () => {
    pveFetchMock.mockResolvedValue([
      { upid: 'u1', type: 'qmstart', status: 'FAILED: exit code 1', starttime: 1000, endtime: 1010, user: 'root@pam', node: 'pve-node-01' },
    ])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    const body = await readJson<any>(res)
    expect(body.data.tasks[0].status).toBe('error')
  })

  it('maps missing status to running', async () => {
    pveFetchMock.mockResolvedValue([
      { upid: 'u1', type: 'qmstart', starttime: 1000, user: 'root@pam', node: 'pve-node-01' },
    ])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    const body = await readJson<any>(res)
    expect(body.data.tasks[0].status).toBe('running')
    expect(body.data.tasks[0].endtime).toBeNull()
    expect(body.data.tasks[0].duration).toBeNull()
  })

  it('formats duration under 60s as Xs', async () => {
    pveFetchMock.mockResolvedValue([
      { upid: 'u1', type: 'qmstart', status: 'OK', starttime: 1000, endtime: 1045, user: 'root@pam', node: 'pve-node-01' },
    ])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    const body = await readJson<any>(res)
    expect(body.data.tasks[0].duration).toBe(45)
    expect(body.data.tasks[0].durationFormatted).toBe('45s')
  })

  it('formats duration between 60s and 3600s as Xm Ys', async () => {
    pveFetchMock.mockResolvedValue([
      { upid: 'u1', type: 'qmstart', status: 'OK', starttime: 1000, endtime: 1000 + 125, user: 'root@pam', node: 'pve-node-01' },
    ])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    const body = await readJson<any>(res)
    expect(body.data.tasks[0].durationFormatted).toBe('2m 5s')
  })

  it('formats duration >= 3600s as Xh Ym', async () => {
    pveFetchMock.mockResolvedValue([
      { upid: 'u1', type: 'qmstart', status: 'OK', starttime: 1000, endtime: 1000 + 3900, user: 'root@pam', node: 'pve-node-01' },
    ])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    const body = await readJson<any>(res)
    expect(body.data.tasks[0].durationFormatted).toBe('1h 5m')
  })

  it('returns empty tasks list when pveFetch returns null', async () => {
    pveFetchMock.mockResolvedValue(null)
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.tasks).toEqual([])
    expect(body.data.count).toBe(0)
  })

  it('uses url-encoded node name in the api path', async () => {
    pveFetchMock.mockResolvedValue([])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: 'conn-1:qemu:pve node/01:101' }) })
    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: 'conn-1' },
      '/nodes/pve%20node%2F01/tasks?vmid=101&limit=50',
    )
  })

  it('works for LXC guests', async () => {
    pveFetchMock.mockResolvedValue([
      { upid: 'u1', type: 'vzstart', status: 'OK', starttime: 1000, endtime: 1005, user: 'root@pam', node: 'pve-node-01' },
    ])
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: LXC_VM_KEY }) })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.tasks[0].type).toBe('vzstart')
  })

  it('404 when the connection cannot be resolved', async () => {
    getConnectionByIdMock.mockRejectedValue(new Error('nope'))
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    expect(res.status).toBe(404)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/not found/i)
  })

  it('500 on a malformed vmKey', async () => {
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: 'bad-key' }) })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/vmKey|Invalid/i)
  })

  it('500 when pveFetch throws', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE unreachable'))
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toBe('PVE unreachable')
  })
})
