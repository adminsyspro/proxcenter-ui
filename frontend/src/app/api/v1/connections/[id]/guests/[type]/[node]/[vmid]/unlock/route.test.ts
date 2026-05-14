import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const executeSSHMock = vi.fn<(...args: any[]) => Promise<{ success: boolean; output?: string; error?: string }>>()
const getNodeIpMock = vi.fn<(...args: any[]) => Promise<string>>()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/ssh/exec', () => ({ executeSSH: executeSSHMock }))
vi.mock('@/lib/ssh/node-ip', () => ({ getNodeIp: getNodeIpMock }))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: (connId: string, node: string, type: string, vmid: string) =>
    `${connId}:${node}:${type}:${vmid}`,
  PERMISSIONS: { VM_CONFIG: 'vm.config', VM_VIEW: 'vm.view' },
}))

beforeEach(() => {
  pveFetchMock.mockReset()
  getConnectionByIdMock.mockReset()
  checkPermissionMock.mockReset().mockResolvedValue(null)
  executeSSHMock.mockReset()
  getNodeIpMock.mockReset().mockResolvedValue('10.0.0.10')
})

async function importHandlers() {
  return import('./route')
}

const validParams = { id: 'conn-1', type: 'qemu', node: 'pve1', vmid: '100' }

describe('POST unlock - parameter validation', () => {
  it.each([
    ['missing id', { ...validParams, id: '' }],
    ['missing type', { ...validParams, type: '' }],
    ['missing node', { ...validParams, node: '' }],
    ['missing vmid', { ...validParams, vmid: '' }],
  ])('returns 400 when %s', async (_label, params) => {
    const { POST } = await importHandlers()
    const res = await callRoute(POST, { params, body: {} })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('Missing parameters')
  })

  it('rejects unknown guest types (only qemu and lxc allowed)', async () => {
    const { POST } = await importHandlers()
    const res = await callRoute(POST, {
      params: { ...validParams, type: 'docker' },
      body: {},
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/qemu.*lxc/i)
  })

  it('rejects a shell-injection attempt in the node name (assertNodeName)', async () => {
    const { POST } = await importHandlers()
    const res = await callRoute(POST, {
      params: { ...validParams, node: 'pve1; rm -rf /' },
      body: {},
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/Invalid node name/i)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric vmid (assertVmid)', async () => {
    const { POST } = await importHandlers()
    const res = await callRoute(POST, {
      params: { ...validParams, vmid: '100; reboot' },
      body: {},
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/Invalid vmid/i)
    expect(executeSSHMock).not.toHaveBeenCalled()
  })
})

describe('POST unlock - happy paths', () => {
  it('returns "not locked" without invoking SSH when the VM has no lock', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1' })
    pveFetchMock.mockResolvedValueOnce({ name: 'web-01' })  // no lock field

    const { POST } = await importHandlers()
    const res = await callRoute(POST, { params: validParams, body: {} })

    expect(res.status).toBe(200)
    const json = await readJson<any>(res)
    expect(json.data).toMatchObject({ unlocked: false, reason: 'not_locked' })
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(getNodeIpMock).not.toHaveBeenCalled()
  })

  it('unlocks a locked qemu VM with "qm unlock <vmid>" over SSH', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1' })
    pveFetchMock.mockResolvedValueOnce({ lock: 'backup' })
    executeSSHMock.mockResolvedValueOnce({ success: true, output: '' })

    const { POST } = await importHandlers()
    const res = await callRoute(POST, { params: validParams, body: {} })

    expect(res.status).toBe(200)
    const json = await readJson<any>(res)
    expect(json.data).toMatchObject({ unlocked: true, previousLock: 'backup', method: 'ssh' })
    expect(executeSSHMock).toHaveBeenCalledWith('conn-1', '10.0.0.10', 'qm unlock 100')
  })

  it('uses "pct unlock <vmid>" for LXC containers', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1' })
    pveFetchMock.mockResolvedValueOnce({ lock: 'rollback' })
    executeSSHMock.mockResolvedValueOnce({ success: true, output: '' })

    const { POST } = await importHandlers()
    await callRoute(POST, { params: { ...validParams, type: 'lxc', vmid: '200' }, body: {} })

    expect(executeSSHMock).toHaveBeenCalledWith('conn-1', '10.0.0.10', 'pct unlock 200')
  })
})

describe('POST unlock - error cases', () => {
  it('returns 403 when RBAC denies vm.config', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const { POST } = await importHandlers()
    const res = await callRoute(POST, { params: validParams, body: {} })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.config', 'vm', 'conn-1:pve1:qemu:100')
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the connection does not exist', async () => {
    getConnectionByIdMock.mockResolvedValueOnce(null)

    const { POST } = await importHandlers()
    const res = await callRoute(POST, { params: validParams, body: {} })

    expect(res.status).toBe(404)
  })

  it('returns 500 with the manual hint when SSH unlock fails', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1' })
    pveFetchMock.mockResolvedValueOnce({ lock: 'migrate' })
    executeSSHMock.mockResolvedValueOnce({ success: false, error: 'ssh: connect refused' })

    const { POST } = await importHandlers()
    const res = await callRoute(POST, { params: validParams, body: {} })

    expect(res.status).toBe(500)
    const json = await readJson<any>(res)
    expect(json.error).toBe('ssh: connect refused')
    expect(json.lockType).toBe('migrate')
    expect(json.hint).toContain('qm unlock 100')
  })
})

describe('GET unlock - check lock status', () => {
  it('reports locked: true and surfaces the lock type', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1' })
    pveFetchMock.mockResolvedValueOnce({ lock: 'backup' })

    const { GET } = await importHandlers()
    const res = await callRoute(GET, { params: validParams, method: 'GET' })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toEqual({ locked: true, lockType: 'backup' })
  })

  it('reports locked: false when there is no lock', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1' })
    pveFetchMock.mockResolvedValueOnce({})

    const { GET } = await importHandlers()
    const res = await callRoute(GET, { params: validParams, method: 'GET' })

    expect((await readJson<any>(res)).data).toEqual({ locked: false, lockType: null })
  })

  it('checks vm.view (not vm.config) on GET', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1' })
    pveFetchMock.mockResolvedValueOnce({})

    const { GET } = await importHandlers()
    await callRoute(GET, { params: validParams, method: 'GET' })

    expect(checkPermissionMock).toHaveBeenCalledWith('vm.view', 'vm', 'conn-1:pve1:qemu:100')
  })
})
