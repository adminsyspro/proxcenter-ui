import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const findUniqueMock = vi.fn<(args: any) => Promise<any>>()
const findManyMock = vi.fn<(args: any) => Promise<any>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const decryptSecretMock = vi.fn<(s: string) => string>()
const executeSSHDirectMock = vi.fn<(opts: any) => Promise<{ success: boolean; error?: string }>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getNodeIpMock = vi.fn<(...args: any[]) => Promise<string>>()

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: { findUnique: findUniqueMock },
    managedHost: { findMany: findManyMock },
  }),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/crypto/secret', () => ({
  decryptSecret: decryptSecretMock,
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSHDirect: executeSSHDirectMock,
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: getNodeIpMock,
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  findUniqueMock.mockReset()
  findManyMock.mockReset().mockResolvedValue([])
  checkPermissionMock.mockReset().mockResolvedValue(null)
  decryptSecretMock.mockReset().mockImplementation((s: string) => `decrypted:${s}`)
  executeSSHDirectMock.mockReset()
  getConnectionByIdMock.mockReset()
  pveFetchMock.mockReset()
  getNodeIpMock.mockReset()

  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

async function importHandler() {
  const mod = await import('./route')


return mod.POST
}

describe('POST /api/v1/connections/[id]/test-ssh - the issue #303 regression', () => {
  it('uses form-submitted sshEnabled=true even when the DB row still has sshEnabled=false', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'conn-1',
      name: 'PVE Dev',
      type: 'pve',
      baseUrl: 'https://10.0.0.1:8006',
      sshEnabled: false,
      sshPort: null,
      sshUser: null,
      sshAuthMethod: null,
      sshKeyEnc: null,
      sshPassEnc: null,
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        nodes: [{ node: 'pve1', ip: '10.0.0.1', status: 'ok' }],
      }),
    })

    const handler = await importHandler()

    const res = await callRoute(handler, {
      params: { id: 'conn-1' },
      body: {
        sshEnabled: true,
        sshPort: 22,
        sshUser: 'root',
        sshAuthMethod: 'password',
        sshPassword: 'hunter2',
      },
    })

    expect(res.status).toBe(200)
    const json = await readJson<any>(res)

    expect(json.success).toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const orchBody = JSON.parse(init.body as string)

    expect(orchBody).toMatchObject({
      sshEnabled: true,
      sshUser: 'root',
      sshAuthMethod: 'password',
      sshPassword: 'hunter2',
    })
  })

  it('still returns 400 when sshEnabled is false both in DB and in the form (UI button gated, defensive)', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'conn-1',
      type: 'pve',
      baseUrl: 'https://10.0.0.1:8006',
      sshEnabled: false,
      sshPort: null,
      sshUser: null,
      sshAuthMethod: null,
      sshKeyEnc: null,
      sshPassEnc: null,
    })

    const handler = await importHandler()
    const res = await callRoute(handler, { params: { id: 'conn-1' }, body: { sshEnabled: false } })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/SSH is not enabled/i)
  })

  it('falls back to the stored encrypted key when the form leaves sshKey empty and auth method matches', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'conn-1',
      type: 'pve',
      baseUrl: 'https://10.0.0.1:8006',
      sshEnabled: true,
      sshPort: 22,
      sshUser: 'root',
      sshAuthMethod: 'key',
      sshKeyEnc: 'enc-key-blob',
      sshPassEnc: null,
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, nodes: [] }),
    })

    const handler = await importHandler()

    await callRoute(handler, {
      params: { id: 'conn-1' },
      body: { sshEnabled: true, sshAuthMethod: 'key', sshUser: 'root' },
    })

    expect(decryptSecretMock).toHaveBeenCalledWith('enc-key-blob')
    const orchBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)

    expect(orchBody.sshKey).toBe('decrypted:enc-key-blob')
  })

  it('prefers the form-supplied key over the stored encrypted key', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'conn-1',
      type: 'pve',
      baseUrl: 'https://10.0.0.1:8006',
      sshEnabled: true,
      sshPort: 22,
      sshUser: 'root',
      sshAuthMethod: 'key',
      sshKeyEnc: 'enc-key-blob',
      sshPassEnc: null,
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, nodes: [] }),
    })

    const handler = await importHandler()

    await callRoute(handler, {
      params: { id: 'conn-1' },
      body: {
        sshEnabled: true,
        sshAuthMethod: 'key',
        sshKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nFROM-FORM\n-----END-----',
      },
    })

    expect(decryptSecretMock).not.toHaveBeenCalled()
    const orchBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)

    expect(orchBody.sshKey).toContain('FROM-FORM')
  })

  it('does NOT reuse a stored passphrase as a password when the auth method changes (key -> password)', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'conn-1',
      type: 'pve',
      baseUrl: 'https://10.0.0.1:8006',
      sshEnabled: true,
      sshPort: 22,
      sshUser: 'root',
      sshAuthMethod: 'key',          // stored as a passphrase
      sshKeyEnc: 'enc-key',
      sshPassEnc: 'enc-passphrase',
    })

    const handler = await importHandler()

    const res = await callRoute(handler, {
      params: { id: 'conn-1' },
      body: { sshEnabled: true, sshAuthMethod: 'password' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/Missing SSH password/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 with a clear message when the key auth method has no usable key', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'conn-1',
      type: 'pve',
      baseUrl: 'https://10.0.0.1:8006',
      sshEnabled: false,
      sshPort: null,
      sshUser: null,
      sshAuthMethod: null,
      sshKeyEnc: null,
      sshPassEnc: null,
    })

    const handler = await importHandler()

    const res = await callRoute(handler, {
      params: { id: 'conn-1' },
      body: { sshEnabled: true, sshAuthMethod: 'key' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/Missing SSH private key/i)
  })
})

describe('POST /api/v1/connections/[id]/test-ssh - other behavior', () => {
  it('returns 400 when the route param is missing', async () => {
    const handler = await importHandler()
    const res = await callRoute(handler, { params: {} })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('Missing params.id')
  })

  it('honours an RBAC denial from checkPermission', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })

    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const handler = await importHandler()
    const res = await callRoute(handler, { params: { id: 'conn-1' }, body: {} })

    expect(res.status).toBe(403)
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the connection does not exist', async () => {
    findUniqueMock.mockResolvedValueOnce(null)

    const handler = await importHandler()
    const res = await callRoute(handler, { params: { id: 'gone' }, body: {} })

    expect(res.status).toBe(404)
  })

  it('tests VMware ESXi (non-PVE) connections directly via executeSSHDirect, bypassing the orchestrator', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'esxi-1',
      name: 'ESXi Lab',
      type: 'vmware',
      baseUrl: 'https://esxi.lab.local:443',
      sshEnabled: true,
      sshPort: 22,
      sshUser: 'root',
      sshAuthMethod: 'password',
      sshKeyEnc: null,
      sshPassEnc: 'enc-pw',
    })
    executeSSHDirectMock.mockResolvedValueOnce({ success: true })

    const handler = await importHandler()

    const res = await callRoute(handler, {
      params: { id: 'esxi-1' },
      body: { sshEnabled: true, sshAuthMethod: 'password' },
    })

    expect(res.status).toBe(200)
    const json = await readJson<any>(res)

    expect(json.success).toBe(true)
    expect(json.nodes).toHaveLength(1)
    expect(json.nodes[0]).toMatchObject({ node: 'ESXi Lab', ip: 'esxi.lab.local', status: 'ok' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(executeSSHDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'esxi.lab.local',
        port: 22,
        user: 'root',
        password: 'decrypted:enc-pw',
        command: 'hostname',
      }),
    )
  })

  it('falls back to ssh2 per-node when the orchestrator is unreachable (PVE path)', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'conn-1',
      name: 'PVE',
      type: 'pve',
      baseUrl: 'https://10.0.0.1:8006',
      sshEnabled: true,
      sshPort: 22,
      sshUser: 'root',
      sshAuthMethod: 'password',
      sshKeyEnc: null,
      sshPassEnc: 'enc-pw',
    })
    const connErr: any = new Error('fetch failed')

    connErr.cause = { code: 'ECONNREFUSED' }
    fetchMock.mockRejectedValueOnce(connErr)

    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1', baseUrl: 'https://10.0.0.1:8006' })
    pveFetchMock.mockResolvedValueOnce([{ node: 'pve1' }, { node: 'pve2' }])
    getNodeIpMock
      .mockResolvedValueOnce('10.0.0.11')
      .mockResolvedValueOnce('10.0.0.12')
    executeSSHDirectMock
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'timeout' })

    const handler = await importHandler()

    const res = await callRoute(handler, {
      params: { id: 'conn-1' },
      body: { sshEnabled: true, sshAuthMethod: 'password' },
    })

    expect(res.status).toBe(200)
    const json = await readJson<any>(res)

    expect(json.success).toBe(false)
    expect(json.nodes).toHaveLength(2)
    expect(json.nodes[0]).toMatchObject({ node: 'pve1', ip: '10.0.0.11', status: 'ok' })
    expect(json.nodes[1]).toMatchObject({ node: 'pve2', ip: '10.0.0.12', status: 'error', error: 'timeout' })
  })

  it('uses the per-host sshAddress override when one is configured', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'conn-1',
      type: 'pve',
      baseUrl: 'https://10.0.0.1:8006',
      sshEnabled: true,
      sshPort: 22,
      sshUser: 'root',
      sshAuthMethod: 'password',
      sshKeyEnc: null,
      sshPassEnc: 'enc-pw',
    })
    const connErr: any = new Error('fetch failed')

    connErr.cause = { code: 'ECONNREFUSED' }
    fetchMock.mockRejectedValueOnce(connErr)

    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1' })
    pveFetchMock.mockResolvedValueOnce([{ node: 'pve1' }])
    findManyMock.mockResolvedValueOnce([{ node: 'pve1', sshAddress: '172.16.0.99' }])
    executeSSHDirectMock.mockResolvedValueOnce({ success: true })

    const handler = await importHandler()

    await callRoute(handler, {
      params: { id: 'conn-1' },
      body: { sshEnabled: true, sshAuthMethod: 'password' },
    })

    expect(getNodeIpMock).not.toHaveBeenCalled()
    expect(executeSSHDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: '172.16.0.99' }),
    )
  })
})
