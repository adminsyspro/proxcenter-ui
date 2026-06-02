import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const getNodeIpMock = vi.fn<(...args: any[]) => Promise<string>>()
const executeSSHMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildNodeResourceId: (c: string, n: string) => `${c}:${n}`,
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/ssh/node-ip', () => ({ getNodeIp: getNodeIpMock }))
vi.mock('@/lib/ssh/exec', () => ({ executeSSH: executeSSHMock }))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ baseUrl: 'https://203.0.113.10:8006' })
  getNodeIpMock.mockReset()
  executeSSHMock.mockReset()
})

const importPOST = async () => (await import('./route')).POST as Parameters<typeof callRoute>[0]
const importGET = async () => (await import('./route')).GET as Parameters<typeof callRoute>[0]

describe('POST upgrade — identity guard', () => {
  it('launches the upgrade when the target is the connection host and hostname matches', async () => {
    getNodeIpMock.mockResolvedValue('203.0.113.10')
    executeSSHMock
      .mockResolvedValueOnce({ success: true, output: 'pve1' }) // probe
      .mockResolvedValueOnce({ success: true })                 // script
    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, body: {} })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ started: true })
    expect(executeSSHMock).toHaveBeenCalledTimes(2)
  })

  it('refuses (409) and does NOT launch when hostname mismatches', async () => {
    getNodeIpMock.mockResolvedValue('203.0.113.10')
    executeSSHMock.mockResolvedValueOnce({ success: true, output: 'bastion' }) // probe only
    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, body: {} })
    expect(res.status).toBe(409)
    expect(executeSSHMock).toHaveBeenCalledTimes(1)
  })

  it('skips the probe for a direct-IP resolution and launches', async () => {
    getNodeIpMock.mockResolvedValue('10.0.0.5') // != connHost
    executeSSHMock.mockResolvedValueOnce({ success: true }) // script only
    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, body: {} })
    expect(res.status).toBe(200)
    expect(executeSSHMock).toHaveBeenCalledTimes(1)
  })

  it('returns the actionable C error when the script SSH fails to a private IP', async () => {
    getNodeIpMock.mockResolvedValue('10.0.0.5')
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'timeout' })
    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1', node: 'pve1' }, body: {} })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toMatch(/private address/)
  })
})

describe('GET upgrade poll — shared error', () => {
  it('returns the actionable C error when polling a private IP fails', async () => {
    getNodeIpMock.mockResolvedValue('10.0.0.5')
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'timeout' })
    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve1' } })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toMatch(/private address/)
  })
})
