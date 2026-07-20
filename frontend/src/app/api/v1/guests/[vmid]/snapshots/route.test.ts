import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'en' }) }),
}))

vi.mock('@/lib/connections/getConnection', () => ({
  // The not-found vs real-error mapping now lives in getConnectionByIdOrNull
  // (unit-tested in getConnection.test.ts); the route just consumes its result.
  getConnectionByIdOrNull: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  buildVmResourceId: vi.fn<(...args: any[]) => string>(
    (connId, node, type, vmid) => `${connId}:${node}:${type}:${vmid}`
  ),
  PERMISSIONS: {
    VM_VIEW: 'vm.view',
    VM_SNAPSHOT: 'vm.snapshot',
  },
}))

vi.mock('@/lib/i18n/date', () => ({
  getDateLocale: vi.fn<(locale: string) => string>((l) => l),
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn<() => Promise<string>>(),
}))

vi.mock('@/lib/vdc/quota', () => ({
  resolveVdcForTenant: vi.fn<(...args: any[]) => Promise<any>>(),
  checkVdcQuota: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/audit', () => ({
  audit: vi.fn<(...args: any[]) => Promise<void>>(),
}))

vi.mock('@/lib/proxmox/tasks', () => ({
  waitForTask: vi.fn<(...args: any[]) => Promise<void>>(),
}))

import { GET, POST, DELETE } from './route'
import { getConnectionByIdOrNull } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { resolveVdcForTenant, checkVdcQuota } from '@/lib/vdc/quota'
import { audit } from '@/lib/audit'
import { waitForTask } from '@/lib/proxmox/tasks'

const getConnectionByIdOrNullMock = getConnectionByIdOrNull as any
const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const getCurrentTenantIdMock = getCurrentTenantId as any
const resolveVdcForTenantMock = resolveVdcForTenant as any
const checkVdcQuotaMock = checkVdcQuota as any
const auditMock = audit as any
const waitForTaskMock = waitForTask as any

const VM_KEY = 'conn-1:qemu:pve-node-01:101'
const CONN_ID = 'conn-1'
const NODE = 'pve-node-01'
const VMID = '101'

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdOrNullMock.mockResolvedValue({ id: CONN_ID })
  pveFetchMock.mockResolvedValue([])
  getCurrentTenantIdMock.mockResolvedValue('default')
  resolveVdcForTenantMock.mockResolvedValue(null)
  checkVdcQuotaMock.mockResolvedValue({ allowed: true })
  auditMock.mockResolvedValue(undefined)
  waitForTaskMock.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
describe('GET /api/v1/guests/[vmid]/snapshots', () => {
  it('returns empty list when pveFetch returns []', async () => {
    pveFetchMock.mockResolvedValue([])
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ vmid: VM_KEY }),
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.snapshots).toEqual([])
    expect(body.data.count).toBe(0)
  })

  it('filters out "current" pseudo-snapshot and sorts by snaptime desc', async () => {
    pveFetchMock.mockResolvedValue([
      { name: 'current', snaptime: 9999 },
      { name: 'snap-a', snaptime: 100, description: 'first', vmstate: false },
      { name: 'snap-b', snaptime: 200, description: 'second', vmstate: true },
    ])
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ vmid: VM_KEY }),
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.count).toBe(2)
    expect(body.data.snapshots[0].name).toBe('snap-b')
    expect(body.data.snapshots[1].name).toBe('snap-a')
  })

  it('404 when connection not found', async () => {
    getConnectionByIdOrNullMock.mockResolvedValue(null)
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ vmid: VM_KEY }),
    })
    // getConnection wrapper maps a genuine not-found to null -> 404
    expect(res.status).toBe(404)
  })

  it('500 when getConnection fails with a non-not-found error (no longer masked as 404)', async () => {
    getConnectionByIdOrNullMock.mockRejectedValue(new Error('DB error'))
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ vmid: VM_KEY }),
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/DB error/i)
  })

  it('403 when RBAC denies vm.view', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ vmid: VM_KEY }),
    })
    expect(res.status).toBe(403)
  })

  it('500 on malformed vmKey', async () => {
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ vmid: 'bad' }),
    })
    expect(res.status).toBe(500)
  })

  it('calls pveFetch with correct snapshot path', async () => {
    pveFetchMock.mockResolvedValue([])
    await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ vmid: VM_KEY }),
    })
    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: CONN_ID },
      `/nodes/${NODE}/qemu/${VMID}/snapshot`
    )
  })
})

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
describe('POST /api/v1/guests/[vmid]/snapshots', () => {
  it('400 when name is missing', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { vmid: VM_KEY },
      body: { description: 'no name here' },
    })
    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('400 when name contains invalid characters', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { vmid: VM_KEY },
      body: { name: 'bad name!' },
    })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/Invalid snapshot name/)
  })

  it('404 when connection not found', async () => {
    getConnectionByIdOrNullMock.mockResolvedValue(null)
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { vmid: VM_KEY },
      body: { name: 'snap1' },
    })
    expect(res.status).toBe(404)
  })

  it('403 when RBAC denies vm.snapshot', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { vmid: VM_KEY },
      body: { name: 'snap1' },
    })
    expect(res.status).toBe(403)
  })

  it('409 when vDC quota exceeded', async () => {
    resolveVdcForTenantMock.mockResolvedValue({ poolName: 'pool1', quota: { maxSnapshots: 1 } })
    checkVdcQuotaMock.mockResolvedValue({ allowed: false, violations: ['maxSnapshots'] })
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { vmid: VM_KEY },
      body: { name: 'snap1' },
    })
    expect(res.status).toBe(409)
    const body = await readJson<any>(res)
    expect(body.error).toBe('Quota exceeded')
  })

  it('403 when vDC quota check throws NODE_NOT_AUTHORIZED', async () => {
    resolveVdcForTenantMock.mockRejectedValue(Object.assign(new Error('NODE_NOT_AUTHORIZED'), { message: 'NODE_NOT_AUTHORIZED' }))
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { vmid: VM_KEY },
      body: { name: 'snap1' },
    })
    expect(res.status).toBe(403)
  })

  it('200 happy path: creates snapshot with name + description, calls audit', async () => {
    pveFetchMock.mockResolvedValue('UPID:snap:task')
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { vmid: VM_KEY },
      body: { name: 'snap1', description: 'my snap', vmstate: true },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.success).toBe(true)
    expect(body.data.upid).toBe('UPID:snap:task')

    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: CONN_ID },
      `/nodes/${NODE}/qemu/${VMID}/snapshot`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
    )
    const callArgs = pveFetchMock.mock.calls[0]
    expect(callArgs[2].body).toContain('snapname=snap1')
    expect(callArgs[2].body).toContain('description=my+snap')
    expect(callArgs[2].body).toContain('vmstate=1')

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'snapshot', resourceId: VMID })
    )
  })

  it('200: lxc snapshot does not include vmstate in body', async () => {
    pveFetchMock.mockResolvedValue('UPID:snap:lxc')
    const lxcKey = 'conn-1:lxc:pve-node-01:201'
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { vmid: lxcKey },
      body: { name: 'snap1', vmstate: true },
    })
    expect(res.status).toBe(200)
    const callArgs = pveFetchMock.mock.calls[0]
    expect(callArgs[2].body).not.toContain('vmstate')
  })

  it('500 when pveFetch throws', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE error'))
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { vmid: VM_KEY },
      body: { name: 'snap1' },
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toBe('PVE error')
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('DELETE /api/v1/guests/[vmid]/snapshots', () => {
  it('400 when ?name query param is missing', async () => {
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { vmid: VM_KEY },
      url: 'http://test.local/_',
    })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/Snapshot name is required/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403 when RBAC denies vm.snapshot', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { vmid: VM_KEY },
      searchParams: { name: 'snap1' },
    })
    expect(res.status).toBe(403)
  })

  it('404 when connection not found', async () => {
    getConnectionByIdOrNullMock.mockResolvedValue(null)
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { vmid: VM_KEY },
      searchParams: { name: 'snap1' },
    })
    expect(res.status).toBe(404)
  })

  it('200 happy path: deletes named snapshot and calls audit', async () => {
    pveFetchMock.mockResolvedValue('UPID:delete-snap:task')
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { vmid: VM_KEY },
      searchParams: { name: 'snap1' },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.success).toBe(true)
    expect(body.data.upid).toBe('UPID:delete-snap:task')

    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: CONN_ID },
      `/nodes/${NODE}/qemu/${VMID}/snapshot/snap1`,
      { method: 'DELETE' }
    )
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', resourceId: VMID })
    )
  })

  it('500 when pveFetch throws on delete', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE 500'))
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { vmid: VM_KEY },
      searchParams: { name: 'snap1' },
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toBe('PVE 500')
  })

  it('does NOT wait when ?wait is absent (fire-and-forget)', async () => {
    pveFetchMock.mockResolvedValue('UPID:pve1:xxx')
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { vmid: VM_KEY },
      searchParams: { name: 'snap1' },
    })
    expect(res.status).toBe(200)
    expect(waitForTaskMock).not.toHaveBeenCalled()
    const body = await readJson<any>(res)
    expect(body.data.success).toBe(true)
  })

  it('waits for the task when ?wait=1 and returns success on completion', async () => {
    pveFetchMock.mockResolvedValue('UPID:pve1:xxx')
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { vmid: VM_KEY },
      searchParams: { name: 'snap1', wait: '1' },
    })
    expect(res.status).toBe(200)
    expect(waitForTaskMock).toHaveBeenCalledWith({ id: CONN_ID }, NODE, 'UPID:pve1:xxx')
    const body = await readJson<any>(res)
    expect(body.data.success).toBe(true)
  })

  it('returns 500 with the PVE message when ?wait=1 and the task fails', async () => {
    pveFetchMock.mockResolvedValue('UPID:pve1:xxx')
    waitForTaskMock.mockRejectedValue(new Error('PVE task failed: got timeout'))
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { vmid: VM_KEY },
      searchParams: { name: 'snap1', wait: '1' },
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/task failed/i)
  })
})
