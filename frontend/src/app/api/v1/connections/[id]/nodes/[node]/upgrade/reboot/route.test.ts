import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { NODE_MGMT_SSH_TIMEOUT_MS } from '@/lib/ssh/exec'

const { checkPermissionMock, getConnectionByIdMock, getNodeIpMock, executeSSHMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  getConnectionByIdMock: vi.fn<(id: string) => Promise<any>>(),
  getNodeIpMock: vi.fn<(...args: any[]) => Promise<string>>(),
  executeSSHMock: vi.fn<(...args: any[]) => Promise<any>>(),
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

vi.mock('@/lib/ssh/exec', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ssh/exec')>()
  return { ...actual, executeSSH: executeSSHMock }
})

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'c1', baseUrl: 'https://10.0.0.1:8006' })
  getNodeIpMock.mockReset().mockResolvedValue('203.0.113.9')
  executeSSHMock.mockReset().mockResolvedValue({ success: true, output: '' })
})

async function importPOST() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

describe('POST .../upgrade/reboot SSH budget (#370)', () => {
  it('reboots with the WAN node-management budget', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, method: 'POST' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ rebooting: true })

    const [, , command, timeoutMs] = executeSSHMock.mock.calls[0]
    expect(command).toContain('reboot')
    expect(timeoutMs).toBe(NODE_MGMT_SSH_TIMEOUT_MS)
    expect(timeoutMs).toBeGreaterThan(30_000)
  })

  it('returns 500 when the reboot command fails', async () => {
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'boom' })
    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, method: 'POST' })

    expect(res.status).toBe(500)
  })
})
