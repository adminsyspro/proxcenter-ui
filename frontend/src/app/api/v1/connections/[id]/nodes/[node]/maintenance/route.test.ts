import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<any>>(),
  buildNodeResourceId: vi.fn<(connId: string, node: string) => string>(
    (connId, node) => `${connId}:${node}`
  ),
  PERMISSIONS: {
    NODE_VIEW: 'node.view',
    NODE_MANAGE: 'node.manage',
  },
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: vi.fn<(...args: any[]) => Promise<string>>(),
}))

import { GET, POST, DELETE } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { executeSSH } from '@/lib/ssh/exec'
import { getNodeIp } from '@/lib/ssh/node-ip'

const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const checkPermissionMock = checkPermission as any
const executeSSHMock = executeSSH as any
const getNodeIpMock = getNodeIp as any

const CONN_ID = 'conn-1'
const NODE = 'pve-node-01'
const NODE_IP = '10.0.0.1'

const baseParams = { id: CONN_ID, node: NODE }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  pveFetchMock.mockResolvedValue([])
  getNodeIpMock.mockResolvedValue(NODE_IP)
  executeSSHMock.mockResolvedValue({ success: true, output: '' })
})

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
describe('GET /api/v1/connections/[id]/nodes/[node]/maintenance', () => {
  it('returns maintenance=null when node is not in maintenance', async () => {
    pveFetchMock.mockResolvedValue([{ node: NODE, hastate: 'started' }])
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.maintenance).toBeNull()
  })

  it('returns maintenance="maintenance" when hastate is maintenance', async () => {
    pveFetchMock.mockResolvedValue([{ node: NODE, hastate: 'maintenance' }])
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.maintenance).toBe('maintenance')
  })

  it('returns maintenance=null when node is not in the resource list', async () => {
    pveFetchMock.mockResolvedValue([{ node: 'other-node', hastate: 'maintenance' }])
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.maintenance).toBeNull()
  })

  it('returns maintenance=null when pveFetch rejects (swallowed via .catch)', async () => {
    pveFetchMock.mockRejectedValue(new Error('cluster unreachable'))
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.maintenance).toBeNull()
  })

  it('403 when RBAC denies node.view', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(403)
  })

  it('500 when getConnectionById throws', async () => {
    getConnectionByIdMock.mockRejectedValue(new Error('DB error'))
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(baseParams),
    })
    expect(res.status).toBe(500)
  })

  it('calls pveFetch with correct cluster resources path', async () => {
    pveFetchMock.mockResolvedValue([])
    await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(baseParams),
    })
    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: CONN_ID },
      '/cluster/resources?type=node'
    )
  })
})

// ---------------------------------------------------------------------------
// POST (enter maintenance)
// ---------------------------------------------------------------------------
describe('POST /api/v1/connections/[id]/nodes/[node]/maintenance', () => {
  it('403 when RBAC denies node.manage', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: baseParams,
    })
    expect(res.status).toBe(403)
  })

  it('404 when connection not found', async () => {
    getConnectionByIdMock.mockResolvedValue(null)
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: baseParams,
    })
    expect(res.status).toBe(404)
  })

  it('200 happy path: executes enable SSH command and returns output', async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: 'ok' })
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: baseParams,
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)
    expect(body.method).toBe('ssh')
    expect(body.output).toBe('ok')

    expect(getNodeIpMock).toHaveBeenCalledWith({ id: CONN_ID }, NODE)
    expect(executeSSHMock).toHaveBeenCalledWith(
      CONN_ID,
      NODE_IP,
      `ha-manager crm-command node-maintenance enable ${NODE}`
    )
  })

  it('500 when SSH command fails (success=false)', async () => {
    executeSSHMock.mockResolvedValue({ success: false, error: 'permission denied' })
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: baseParams,
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toBe('permission denied')
    expect(body.hint).toContain('ha-manager crm-command node-maintenance enable')
  })

  it('500 when executeSSH throws', async () => {
    executeSSHMock.mockRejectedValue(new Error('SSH connection refused'))
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: baseParams,
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toBe('SSH connection refused')
  })
})

// ---------------------------------------------------------------------------
// DELETE (exit maintenance)
// ---------------------------------------------------------------------------
describe('DELETE /api/v1/connections/[id]/nodes/[node]/maintenance', () => {
  it('403 when RBAC denies node.manage', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: baseParams,
    })
    expect(res.status).toBe(403)
  })

  it('404 when connection not found', async () => {
    getConnectionByIdMock.mockResolvedValue(null)
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: baseParams,
    })
    expect(res.status).toBe(404)
  })

  it('200 happy path: executes disable SSH command and returns output', async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: 'done' })
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: baseParams,
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)
    expect(body.method).toBe('ssh')

    expect(executeSSHMock).toHaveBeenCalledWith(
      CONN_ID,
      NODE_IP,
      `ha-manager crm-command node-maintenance disable ${NODE}`
    )
  })

  it('500 when SSH command fails (success=false)', async () => {
    executeSSHMock.mockResolvedValue({ success: false, error: 'not in maintenance' })
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: baseParams,
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toBe('not in maintenance')
    expect(body.hint).toContain('ha-manager crm-command node-maintenance disable')
  })

  it('500 when executeSSH throws', async () => {
    executeSSHMock.mockRejectedValue(new Error('timeout'))
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: baseParams,
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toBe('timeout')
  })
})
