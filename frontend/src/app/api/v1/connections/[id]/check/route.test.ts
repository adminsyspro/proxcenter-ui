// src/app/api/v1/connections/[id]/check/route.test.ts
//
// Mock-based tests for POST /api/v1/connections/[id]/check: permission gate,
// not-found and non-PVE answers, and the context handed to the runner.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string, tenantId?: string) => Promise<any>>()
const runConnectionCheckMock = vi.fn<(...args: any[]) => Promise<any>>()
const decryptSecretMock = vi.fn<(s: string) => string>()
const findUniqueMock = vi.fn<(args: any) => Promise<any>>()
const findManyMock = vi.fn<(args: any) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: vi.fn(async () => ({
    connection: { findUnique: findUniqueMock },
    managedHost: { findMany: findManyMock },
  })),
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/connections/check/runConnectionCheck', () => ({
  runConnectionCheck: runConnectionCheckMock,
}))

vi.mock('@/lib/crypto/secret', () => ({
  decryptSecret: decryptSecretMock,
}))

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: 'c1',
    type: 'pve',
    fingerprint: null,
    sshEnabled: false,
    sshPort: 22,
    sshUser: 'root',
    sshAuthMethod: null,
    sshKeyEnc: null,
    sshPassEnc: null,
    ...overrides,
  }
}

async function importPOST() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  findUniqueMock.mockReset().mockResolvedValue(makeRow())
  findManyMock.mockReset().mockResolvedValue([])
  getConnectionByIdMock.mockReset().mockResolvedValue({
    id: 'c1',
    name: 'lab',
    baseUrl: 'https://10.42.0.101:8006',
    apiToken: 'u@pve!t=secret',
    insecureDev: true,
    behindProxy: false,
  })
  runConnectionCheckMock.mockReset().mockResolvedValue([{ id: 'quorum', probe: 'quorum', status: 'ok', hint: 'quorum.ok', params: {} }])
  decryptSecretMock.mockReset().mockImplementation((s: string) => `dec:${s}`)
})

describe('POST /api/v1/connections/[id]/check', () => {
  it('requires connection.manage on the connection before touching the row', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1' }, method: 'POST' })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.manage', 'connection', 'c1')
    expect(findUniqueMock).not.toHaveBeenCalled()
    expect(runConnectionCheckMock).not.toHaveBeenCalled()
  })

  it('returns 400 without an id and 404 for an unknown connection', async () => {
    const POST = await importPOST()
    expect((await callRoute(POST, { params: {}, method: 'POST' })).status).toBe(400)

    findUniqueMock.mockResolvedValueOnce(null)
    const res = await callRoute(POST, { params: { id: 'nope' }, method: 'POST' })
    expect(res.status).toBe(404)
    expect(runConnectionCheckMock).not.toHaveBeenCalled()
  })

  it('refuses non-PVE connections', async () => {
    findUniqueMock.mockResolvedValueOnce(makeRow({ type: 'pbs' }))
    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1' }, method: 'POST' })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/Proxmox VE/)
    expect(runConnectionCheckMock).not.toHaveBeenCalled()
  })

  it('answers { items } from the runner with the fallback hosts and SSH settings resolved', async () => {
    findUniqueMock.mockResolvedValueOnce(makeRow({ fingerprint: 'AA:BB', sshEnabled: true, sshPort: 2222, sshUser: 'ops', sshKeyEnc: 'K', sshPassEnc: 'P' }))
    findManyMock.mockResolvedValueOnce([
      { node: 'pve1', ip: '10.42.0.101', enabled: true, sshAddress: null, sshPort: null },
      { node: 'pve2', ip: '10.42.0.102', enabled: true, sshAddress: '10.9.0.2', sshPort: 2200 },
      { node: 'pve3', ip: '10.42.0.103', enabled: false, sshAddress: null, sshPort: null },
      { node: 'pve4', ip: null, enabled: true, sshAddress: null, sshPort: null },
    ])

    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1' }, method: 'POST' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ items: [{ id: 'quorum', probe: 'quorum', status: 'ok', hint: 'quorum.ok', params: {} }] })

    expect(runConnectionCheckMock).toHaveBeenCalledTimes(1)
    const ctx = runConnectionCheckMock.mock.calls[0][0]
    expect(ctx).toMatchObject({
      connectionId: 'c1',
      conn: { id: 'c1', baseUrl: 'https://10.42.0.101:8006', apiToken: 'u@pve!t=secret', insecureDev: true, behindProxy: false },
      fallbackHosts: [
        { node: 'pve1', ip: '10.42.0.101' },
        { node: 'pve2', ip: '10.42.0.102' },
      ],
      pinnedFingerprint: 'AA:BB',
      ssh: { enabled: true, user: 'ops', port: 2222, key: 'dec:K', passphrase: 'dec:P' },
    })
    expect(ctx.ssh.password).toBeUndefined()
    expect(ctx.ssh.overrides).toEqual([
      { node: 'pve1', sshAddress: null, sshPort: null },
      { node: 'pve2', sshAddress: '10.9.0.2', sshPort: 2200 },
      { node: 'pve3', sshAddress: null, sshPort: null },
      { node: 'pve4', sshAddress: null, sshPort: null },
    ])
  })

  it('uses the stored password when no key is stored', async () => {
    findUniqueMock.mockResolvedValueOnce(makeRow({ sshEnabled: true, sshAuthMethod: 'password', sshPassEnc: 'P' }))
    const POST = await importPOST()
    await callRoute(POST, { params: { id: 'c1' }, method: 'POST' })
    const ctx = runConnectionCheckMock.mock.calls[0][0]
    expect(ctx.ssh).toMatchObject({ enabled: true, password: 'dec:P' })
    expect(ctx.ssh.key).toBeUndefined()
  })

  it('answers 500 with the message when the runner throws', async () => {
    runConnectionCheckMock.mockRejectedValueOnce(new Error('runner down'))
    const POST = await importPOST()
    const res = await callRoute(POST, { params: { id: 'c1' }, method: 'POST' })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('runner down')
  })
})
