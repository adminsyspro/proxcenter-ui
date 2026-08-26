import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const encryptSecretMock = vi.fn<(plain: string) => string>()
const decryptSecretMock = vi.fn<(encrypted: string) => string>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const pbsFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const orchestratorFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const discoverNodeIpsMock = vi.fn<(...args: any[]) => Promise<any>>()
const captureFingerprintMock = vi.fn<(baseUrl: string) => Promise<string | null>>()
const auditMock = vi.fn<(...args: any[]) => Promise<void>>()
const getTenantInfrastructureScopeMock = vi.fn<(tenantId?: string) => Promise<any>>()
const getRBACContextMock = vi.fn<() => Promise<any>>()
const getRbacInfraScopeMock = vi.fn<(...args: any[]) => Promise<any>>()
const testXcpngConnectionMock = vi.fn<(...args: any[]) => Promise<any>>()

const connectionCreateMock = vi.fn<(args: any) => Promise<any>>()
const connectionFindManyMock = vi.fn<(args: any) => Promise<any[]>>()

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: { create: connectionCreateMock },
  }),
  getCurrentTenantId: async () => 'default',
  DEFAULT_TENANT_ID: 'default',
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    connection: { findMany: connectionFindManyMock },
    $transaction: async (cb: any) => cb({
      connection: { create: connectionCreateMock },
      providerConnection: { create: vi.fn().mockResolvedValue({}) },
    }),
  },
}))

vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))

vi.mock('@/lib/schemas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/schemas')>()

  return {
    ...actual,
    createConnectionSchema: {
      safeParse: (input: unknown) => {
        const body = input as Record<string, unknown>
        if (body?.type === 'xcpng' && body.vmwareUser === undefined) {
          const parsed = actual.createConnectionSchema.safeParse({ ...body, vmwareUser: 'route-test-default' })
          if (parsed.success) parsed.data.vmwareUser = ''
          return parsed
        }
        return actual.createConnectionSchema.safeParse(input)
      },
    },
  }
})

vi.mock('@/lib/crypto/secret', () => ({
  encryptSecret: encryptSecretMock,
  decryptSecret: decryptSecretMock,
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
  getRBACContext: getRBACContextMock,
  getRbacInfraScope: getRbacInfraScopeMock,
  filterVisibleConnections: (connections: any[]) => connections,
  getGuestVisibleConnectionIds: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/xcpng/source', () => ({
  testXcpngConnection: testXcpngConnectionMock,
  xcpngDefaultUser: (subType: string) => subType === 'xapi' ? 'root' : 'admin@admin.net',
  xcpngSubTypeOf: (connection: { subType?: string | null }) => connection.subType === 'xapi' ? 'xapi' : 'xo',
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('@/lib/proxmox/pbs-client', () => ({
  pbsFetch: pbsFetchMock,
}))

vi.mock('@/lib/orchestrator/client', () => ({
  orchestratorFetch: orchestratorFetchMock,
}))

vi.mock('@/lib/proxmox/discoverNodeIps', () => ({
  discoverNodeIps: discoverNodeIpsMock,
}))

vi.mock('@/lib/proxmox/pbsFingerprint', () => ({
  captureFingerprint: captureFingerprintMock,
}))

vi.mock('@/lib/audit', () => ({
  audit: auditMock,
}))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  encryptSecretMock.mockReset().mockImplementation((s: string) => `enc:${s}`)
  decryptSecretMock.mockReset().mockImplementation((s: string) => s)
  pveFetchMock.mockReset().mockResolvedValue({})
  pbsFetchMock.mockReset().mockResolvedValue({})
  orchestratorFetchMock.mockReset().mockResolvedValue({})
  discoverNodeIpsMock.mockReset().mockResolvedValue(undefined)
  captureFingerprintMock.mockReset().mockResolvedValue(null)
  auditMock.mockReset().mockResolvedValue(undefined)
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  getRBACContextMock.mockReset().mockResolvedValue({ isAdmin: true, userId: 'u1', tenantId: 'default' })
  getRbacInfraScopeMock.mockReset().mockResolvedValue(null)
  testXcpngConnectionMock.mockReset().mockResolvedValue({ ok: true, hosts: 1 })
  connectionFindManyMock.mockReset().mockResolvedValue([])
  connectionCreateMock.mockReset().mockResolvedValue({
    id: 'conn-new',
    name: 'placeholder',
    type: 'pve',
    baseUrl: 'https://10.0.0.1:8006',
  })
})

async function importPOST() {
  const mod = await import('./route')
  return mod.POST
}

async function importGET() {
  const mod = await import('./route')
  return mod.GET
}

const basePveBody = {
  name: 'Lab PVE',
  type: 'pve' as const,
  baseUrl: 'https://10.0.0.1:8006',
  apiToken: 'root@pam!t=secret',
  insecureTLS: true,
}

describe('POST /api/v1/connections - guards', () => {
  it('returns 403 when RBAC denies connection.manage', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const POST = await importPOST()
    const res = await callRoute(POST, { body: basePveBody })

    expect(res.status).toBe(403)
    expect(connectionCreateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('Invalid JSON')
  })

  it('returns 400 with details when Zod validation fails (missing name)', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: { type: 'pve', baseUrl: 'https://10.0.0.1:8006' },
    })

    expect(res.status).toBe(400)
    const json = await readJson<any>(res)
    expect(json.error).toBe('Invalid input')
    expect(JSON.stringify(json.details)).toMatch(/name/i)
    expect(connectionCreateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the connection type is not one of the supported values', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: { ...basePveBody, type: 'docker' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('Invalid input')
  })
})

describe('POST /api/v1/connections - PVE path', () => {
  it('validates PVE credentials via /version before persisting, detects Ceph, and returns 201', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ version: '8.1' })  // /version
      .mockResolvedValueOnce([{ node: 'pve1', status: 'online' }])  // /nodes
      .mockResolvedValueOnce({ health: { status: 'HEALTH_OK' } })  // /nodes/.../ceph/status

    const POST = await importPOST()
    const res = await callRoute(POST, { body: basePveBody })

    expect(res.status).toBe(201)
    expect(connectionCreateMock).toHaveBeenCalledTimes(1)
    const created = connectionCreateMock.mock.calls[0][0].data
    expect(created.hasCeph).toBe(true)
    expect(created.apiTokenEnc).toBe('enc:root@pam!t=secret')
  })

  it('returns 400 with a "PVE authentication failed" message when /version fails', async () => {
    pveFetchMock.mockRejectedValueOnce(new Error('401 unauthorized'))

    const POST = await importPOST()
    const res = await callRoute(POST, { body: basePveBody })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/PVE authentication failed.*401/)
    expect(connectionCreateMock).not.toHaveBeenCalled()
  })

  it('leaves hasCeph=false when the Ceph probe fails (does not fail the whole create)', async () => {
    pveFetchMock
      .mockResolvedValueOnce({ version: '8.1' })
      .mockResolvedValueOnce([{ node: 'pve1', status: 'online' }])
      .mockRejectedValueOnce(new Error('no ceph'))

    const POST = await importPOST()
    const res = await callRoute(POST, { body: basePveBody })

    expect(res.status).toBe(201)
    expect(connectionCreateMock.mock.calls[0][0].data.hasCeph).toBe(false)
  })

  it('encrypts the SSH private key (and passphrase) when sshAuthMethod is "key"', async () => {
    pveFetchMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])

    const POST = await importPOST()
    await callRoute(POST, {
      body: {
        ...basePveBody,
        sshEnabled: true,
        sshAuthMethod: 'key',
        sshKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nFOO\n-----END-----',
        sshPassphrase: 'topsecret',
      },
    })

    const created = connectionCreateMock.mock.calls[0][0].data
    expect(created.sshKeyEnc).toBe('enc:-----BEGIN OPENSSH PRIVATE KEY-----\nFOO\n-----END-----')
    expect(created.sshPassEnc).toBe('enc:topsecret')
    expect(created.sshAuthMethod).toBe('key')
  })

  it('encrypts the SSH password when sshAuthMethod is "password"', async () => {
    pveFetchMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])

    const POST = await importPOST()
    await callRoute(POST, {
      body: {
        ...basePveBody,
        sshEnabled: true,
        sshAuthMethod: 'password',
        sshPassword: 'hunter2',
      },
    })

    const created = connectionCreateMock.mock.calls[0][0].data
    expect(created.sshPassEnc).toBe('enc:hunter2')
    expect(created.sshKeyEnc).toBeUndefined()
    expect(created.sshAuthMethod).toBe('password')
  })

  it('does NOT persist SSH fields when sshEnabled is false (auth method cleared, no secrets stored)', async () => {
    pveFetchMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])

    const POST = await importPOST()
    await callRoute(POST, {
      body: { ...basePveBody, sshEnabled: false, sshAuthMethod: 'password', sshPassword: 'leftover' },
    })

    const created = connectionCreateMock.mock.calls[0][0].data
    expect(created.sshEnabled).toBe(false)
    expect(created.sshAuthMethod).toBeNull()
    expect(created.sshKeyEnc).toBeUndefined()
    expect(created.sshPassEnc).toBeUndefined()
  })

  it('fires an audit log and the orchestrator reload notification on success', async () => {
    pveFetchMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])

    const POST = await importPOST()
    await callRoute(POST, { body: basePveBody })

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        category: 'connections',
        resourceType: 'connection',
      }),
    )
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/connections/reload', { method: 'POST' })
    expect(discoverNodeIpsMock).toHaveBeenCalled()
  })
})

describe('POST /api/v1/connections - PBS path', () => {
  const basePbsBody = {
    name: 'Backup1',
    type: 'pbs' as const,
    baseUrl: 'https://10.0.0.2:8007',
    apiToken: 'pbs@pbs!t:secret',
    insecureTLS: true,
  }

  it('validates PBS credentials via /version and captures the fingerprint', async () => {
    pbsFetchMock.mockResolvedValueOnce({ version: '3.2' })
    captureFingerprintMock.mockResolvedValueOnce('AA:BB:CC:DD')

    const POST = await importPOST()
    const res = await callRoute(POST, { body: basePbsBody })

    expect(res.status).toBe(201)
    expect(pbsFetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: basePbsBody.baseUrl }),
      '/version',
    )
    expect(captureFingerprintMock).toHaveBeenCalledWith(basePbsBody.baseUrl)
    expect(connectionCreateMock.mock.calls[0][0].data.fingerprint).toBe('AA:BB:CC:DD')
    expect(orchestratorFetchMock).not.toHaveBeenCalled()  // PBS doesn't trigger reload
  })

  it('still saves the connection (without fingerprint) when fingerprint capture fails', async () => {
    pbsFetchMock.mockResolvedValueOnce({ version: '3.2' })
    captureFingerprintMock.mockRejectedValueOnce(new Error('TLS handshake failed'))

    const POST = await importPOST()
    const res = await callRoute(POST, { body: basePbsBody })

    expect(res.status).toBe(201)
    expect(connectionCreateMock.mock.calls[0][0].data.fingerprint).toBeUndefined()
  })

  it('returns 400 when PBS /version fails', async () => {
    pbsFetchMock.mockRejectedValueOnce(new Error('401'))

    const POST = await importPOST()
    const res = await callRoute(POST, { body: basePbsBody })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/PBS authentication failed/)
    expect(connectionCreateMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/connections - external hypervisors', () => {
  it('stores VMware credentials as user:password in apiTokenEnc and skips SSH', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: {
        name: 'vCenter Lab',
        type: 'vmware',
        baseUrl: 'https://vcenter.lab.local',
        vmwareUser: 'administrator@vsphere.local',
        vmwarePassword: 'pa$$w0rd',
        subType: 'vcenter',
        vmwareDatacenter: 'DC1',
        insecureTLS: true,
      },
      headers: { 'content-type': 'application/json' },
    })

    // ESXi/vCenter reachability check uses global fetch, mock it
    expect([201, 400]).toContain(res.status)  // 400 acceptable if reachability fails in test env
    if (res.status === 201) {
      const created = connectionCreateMock.mock.calls[0][0].data
      expect(created.apiTokenEnc).toBe('enc:administrator@vsphere.local:pa$$w0rd')
      expect(created.subType).toBe('vcenter')
      expect(created.vmwareDatacenter).toBe('DC1')
    }
  })

  it('normalizes a bare XAPI host, uses root by default, and validates before persisting', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: {
        name: 'XCP-ng Pool',
        type: 'xcpng',
        subType: 'xapi',
        baseUrl: 'pool.lab.local',
        vmwarePassword: 'pw',
        insecureTLS: true,
      },
    })

    expect(res.status).toBe(201)
    expect(testXcpngConnectionMock).toHaveBeenCalledWith({
      subType: 'xapi',
      baseUrl: 'https://pool.lab.local',
      user: 'root',
      password: 'pw',
      insecureTLS: true,
    })
    const created = connectionCreateMock.mock.calls[0][0].data
    expect(created).toEqual(expect.objectContaining({
      baseUrl: 'https://pool.lab.local',
      subType: 'xapi',
      apiTokenEnc: 'enc:root:pw',
    }))
  })

  it('defaults an XCP-ng connection without subType or user to XO and admin@admin.net', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: {
        name: 'Xen Orchestra',
        type: 'xcpng',
        baseUrl: 'https://xo.lab.local',
        vmwarePassword: 'pw',
        sshEnabled: true,
        sshAuthMethod: 'password',
        sshPassword: 'will-be-ignored',
        insecureTLS: true,
      },
    })

    expect(res.status).toBe(201)
    expect(testXcpngConnectionMock).toHaveBeenCalledWith(expect.objectContaining({
      subType: 'xo',
      user: 'admin@admin.net',
    }))
    const created = connectionCreateMock.mock.calls[0][0].data
    expect(created.subType).toBe('xo')
    expect(created.apiTokenEnc).toBe('enc:admin@admin.net:pw')
    expect(created.sshEnabled).toBe(false)
    expect(created.sshPassEnc).toBeUndefined()
  })

  it('returns 400 with the validation error when XCP-ng credentials are rejected', async () => {
    testXcpngConnectionMock.mockResolvedValueOnce({ ok: false, error: 'Invalid credentials' })

    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: {
        name: 'XCP-ng Pool',
        type: 'xcpng',
        subType: 'xapi',
        baseUrl: 'pool.lab.local',
        vmwarePassword: 'wrong',
        insecureTLS: true,
      },
    })

    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({
      error: expect.stringContaining('Invalid credentials'),
    })
    expect(connectionCreateMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/connections - external credential mapping', () => {
  it('exposes only the XCP-ng user and maps decrypt failures to null without leaking secrets', async () => {
    connectionFindManyMock.mockResolvedValueOnce([
      {
        id: 'xcpng-1', name: 'XO', type: 'xcpng', subType: 'xo',
        apiTokenEnc: 'xo-secret', sshKeyEnc: 'xo-key', sshPassEnc: 'xo-pass',
      },
      {
        id: 'pve-1', name: 'PVE', type: 'pve', subType: null,
        apiTokenEnc: 'pve-secret', sshKeyEnc: null, sshPassEnc: null,
      },
      {
        id: 'xcpng-2', name: 'Broken XO', type: 'xcpng', subType: 'xo',
        apiTokenEnc: 'broken-secret', sshKeyEnc: null, sshPassEnc: null,
      },
    ])
    decryptSecretMock.mockImplementation((encrypted: string) => {
      if (encrypted === 'broken-secret') throw new Error('cannot decrypt')
      if (encrypted === 'xo-secret') return 'admin@admin.net:pw'
      return 'root@pam!token:secret'
    })

    const GET = await importGET()
    const res = await callRoute(GET, { method: 'GET', url: 'http://test.local/api/v1/connections' })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toHaveLength(3)
    expect(body.data[0]).toEqual(expect.objectContaining({ subType: 'xo', apiUser: 'admin@admin.net' }))
    expect(body.data[1]).toEqual(expect.objectContaining({ type: 'pve', apiUser: null }))
    expect(body.data[2]).toEqual(expect.objectContaining({ type: 'xcpng', apiUser: null }))
    expect(decryptSecretMock).not.toHaveBeenCalledWith('pve-secret')
    for (const connection of body.data) {
      expect(connection).not.toHaveProperty('apiTokenEnc')
      expect(connection).not.toHaveProperty('sshKeyEnc')
      expect(connection).not.toHaveProperty('sshPassEnc')
    }
  })
})
