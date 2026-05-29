import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { NODE_MGMT_SSH_TIMEOUT_MS } from '@/lib/ssh/exec'

// vi.hoisted so the mocks exist before the (hoisted) async @/lib/ssh/exec
// factory runs. See upgrade/route.test.ts for the same pattern.
const { checkPermissionMock, getConnectionByIdMock, getNodeIpMock, executeSSHMock, pveFetchMock } =
  vi.hoisted(() => ({
    checkPermissionMock: vi.fn<(...args: any[]) => Promise<Response | null>>(),
    getConnectionByIdMock: vi.fn<(id: string) => Promise<any>>(),
    getNodeIpMock: vi.fn<(...args: any[]) => Promise<string>>(),
    executeSSHMock: vi.fn<(...args: any[]) => Promise<any>>(),
    pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  }))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: getNodeIpMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('@/lib/ssh/exec', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ssh/exec')>()
  return { ...actual, executeSSH: executeSSHMock }
})

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'c1', baseUrl: 'https://10.0.0.1:8006' })
  getNodeIpMock.mockReset().mockResolvedValue('203.0.113.9')
  executeSSHMock.mockReset().mockResolvedValue({ success: true, output: 'ok' })
  pveFetchMock.mockReset()
})

async function importHandlers() {
  const mod = await import('./route')
  return mod as {
    GET: Parameters<typeof callRoute>[0]
    POST: Parameters<typeof callRoute>[0]
    DELETE: Parameters<typeof callRoute>[0]
  }
}

describe('maintenance route SSH budget (#370)', () => {
  it('POST enters maintenance with the WAN node-management budget', async () => {
    const { POST } = await importHandlers()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, method: 'POST' })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).success).toBe(true)

    const [, , command, timeoutMs] = executeSSHMock.mock.calls[0]
    expect(command).toContain('node-maintenance enable pve1')
    expect(timeoutMs).toBe(NODE_MGMT_SSH_TIMEOUT_MS)
    expect(timeoutMs).toBeGreaterThan(30_000)
  })

  it('DELETE exits maintenance with the same budget', async () => {
    const { DELETE } = await importHandlers()
    const res = await callRoute(DELETE, { params: { id: 'c1', node: 'pve1' }, method: 'DELETE' })

    expect(res.status).toBe(200)
    const [, , command, timeoutMs] = executeSSHMock.mock.calls[0]
    expect(command).toContain('node-maintenance disable pve1')
    expect(timeoutMs).toBe(NODE_MGMT_SSH_TIMEOUT_MS)
  })

  it('POST surfaces a 500 with a manual hint when SSH fails', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'SSH connection timeout (120s)' })
    const { POST } = await importHandlers()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, method: 'POST' })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('timeout')
    expect(body.hint).toContain('node-maintenance enable')
  })

  it('GET reports maintenance state from cluster resources', async () => {
    pveFetchMock.mockResolvedValueOnce([{ node: 'pve1', hastate: 'maintenance' }])
    const { GET } = await importHandlers()
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { maintenance: 'maintenance' } })
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('returns the denied Response when RBAC rejects the caller', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const { POST } = await importHandlers()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, method: 'POST' })

    expect(res.status).toBe(403)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })
})
