import { describe, it, expect, vi, beforeEach } from 'vitest'


// The IaaS tenant gate of this route is covered by lib/tenant/iaasGuard.routes.test.ts (roadmap#189).
vi.mock("@/lib/tenant/iaasGuard", () => ({ denyIaasTenant: async () => null }))

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const findUniqueMock = vi.fn<(args: any) => Promise<any>>()
const findManyMock = vi.fn<(args: any) => Promise<any>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const decryptSecretMock = vi.fn<(s: string) => string>()
const executeSSHDirectMock = vi.fn<(opts: any) => Promise<{ success: boolean; error?: string; hostKey?: any }>>()
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

const loadSudoRulesMock = vi.fn<() => Promise<{ rules: any[], orchestratorAvailable: boolean }>>()

vi.mock('@/lib/ssh/loadSudoRules', () => ({
  loadSudoRules: loadSudoRulesMock,
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
  loadSudoRulesMock.mockReset()

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

  it('reports the ESXi host key it refused, in the orchestrator wire format, with the endpoint tested', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'esxi-1', name: 'ESXi Lab', type: 'vmware', baseUrl: 'https://esxi.lab.local:443', sshEnabled: true,
      sshPort: 2222, sshUser: 'root', sshAuthMethod: 'password', sshKeyEnc: null, sshPassEnc: 'enc-pw',
    })
    executeSSHDirectMock.mockResolvedValueOnce({
      success: false,
      error: 'SSH host key of esxi.lab.local:2222 is not confirmed',
      hostKey: { endpoint: 'esxi.lab.local:2222', keyType: 'ecdsa-sha2-nistp256', fingerprint: 'SHA256:abc', state: 'unconfirmed' },
    })

    const handler = await importHandler()
    const json = await readJson<any>(await callRoute(handler, { params: { id: 'esxi-1' }, body: { sshEnabled: true, sshAuthMethod: 'password' } }))

    expect(json.nodes[0]).toMatchObject({
      status: 'error', host: 'esxi.lab.local', port: 2222,
      host_key: { endpoint: 'esxi.lab.local:2222', key_type: 'ecdsa-sha2-nistp256', fingerprint: 'SHA256:abc', state: 'unconfirmed' },
    })
  })

  it('reports the host key a node refused on the ssh2 fallback', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'conn-1', name: 'PVE', type: 'pve', baseUrl: 'https://10.0.0.1:8006', sshEnabled: true,
      sshPort: 22, sshUser: 'root', sshAuthMethod: 'password', sshKeyEnc: null, sshPassEnc: 'enc-pw',
    })
    const connErr: any = new Error('fetch failed')
    connErr.cause = { code: 'ECONNREFUSED' }
    fetchMock.mockRejectedValueOnce(connErr)
    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1', baseUrl: 'https://10.0.0.1:8006' })
    pveFetchMock.mockResolvedValueOnce([{ node: 'pve1' }])
    getNodeIpMock.mockResolvedValueOnce('10.0.0.11')
    executeSSHDirectMock.mockResolvedValueOnce({
      success: false, error: 'changed',
      hostKey: { endpoint: '10.0.0.11:22', keyType: 'ssh-ed25519', fingerprint: 'SHA256:new', state: 'mismatch' },
    })

    const handler = await importHandler()
    const json = await readJson<any>(await callRoute(handler, { params: { id: 'conn-1' }, body: { sshEnabled: true, sshAuthMethod: 'password' } }))

    expect(json.nodes[0].host_key).toEqual({ endpoint: '10.0.0.11:22', key_type: 'ssh-ed25519', fingerprint: 'SHA256:new', state: 'mismatch' })
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

  const sshConnRow = {
    id: 'conn-1',
    type: 'pve',
    baseUrl: 'https://203.0.113.10:8006',
    sshEnabled: true,
    sshPort: 22,
    sshUser: 'root',
    sshAuthMethod: 'password',
    sshKeyEnc: null,
    sshPassEnc: 'enc-pw',
  }

  it('forwards the per-node overrides to the orchestrator in the object form', async () => {
    findUniqueMock.mockResolvedValueOnce(sshConnRow)
    findManyMock.mockResolvedValueOnce([
      { node: 'pve1', sshAddress: ' 203.0.113.10 ', sshPort: 2201 },
      { node: 'pve2', sshAddress: '203.0.113.10', sshPort: 2202 },
      { node: 'pve3', sshAddress: null, sshPort: 2203 },
      { node: 'pve4', sshAddress: null, sshPort: null },
    ])
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, nodes: [] }) })

    const handler = await importHandler()

    await callRoute(handler, { params: { id: 'conn-1' }, body: { sshEnabled: true, sshAuthMethod: 'password' } })

    const orchBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)

    expect(orchBody.ssh_overrides).toEqual({
      pve1: { address: '203.0.113.10', port: 2201 },
      pve2: { address: '203.0.113.10', port: 2202 },
      pve3: { address: '', port: 2203 },
    })
  })

  it('sends no ssh_overrides key when no node has an override', async () => {
    findUniqueMock.mockResolvedValueOnce(sshConnRow)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, nodes: [] }) })

    const handler = await importHandler()

    await callRoute(handler, { params: { id: 'conn-1' }, body: { sshEnabled: true, sshAuthMethod: 'password' } })

    const orchBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)

    expect(orchBody).not.toHaveProperty('ssh_overrides')
  })

  it('ssh2 fallback reaches each node on its own port and reports host, port and address source', async () => {
    findUniqueMock.mockResolvedValueOnce(sshConnRow)
    const connErr: any = new Error('fetch failed')

    connErr.cause = { code: 'ECONNREFUSED' }
    fetchMock.mockRejectedValueOnce(connErr)
    getConnectionByIdMock.mockResolvedValueOnce({ id: 'conn-1' })
    pveFetchMock.mockResolvedValueOnce([{ node: 'pve1' }, { node: 'pve2' }])
    findManyMock.mockResolvedValueOnce([{ node: 'pve1', sshAddress: '203.0.113.10', sshPort: 2201 }])
    getNodeIpMock.mockResolvedValueOnce('10.0.0.12')
    executeSSHDirectMock.mockResolvedValue({ success: true })

    const handler = await importHandler()

    const res = await callRoute(handler, {
      params: { id: 'conn-1' },
      body: { sshEnabled: true, sshPort: 2222, sshAuthMethod: 'password' },
    })
    const json = await readJson<any>(res)

    expect(getNodeIpMock).toHaveBeenCalledTimes(1)
    expect(getNodeIpMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'pve2', { skipOverride: true })
    expect(executeSSHDirectMock).toHaveBeenCalledWith(expect.objectContaining({ host: '203.0.113.10', port: 2201 }))
    expect(executeSSHDirectMock).toHaveBeenCalledWith(expect.objectContaining({ host: '10.0.0.12', port: 2222 }))
    expect(json.nodes[0]).toMatchObject({ node: 'pve1', ip: '203.0.113.10', host: '203.0.113.10', port: 2201, address_source: 'override' })
    expect(json.nodes[1]).toMatchObject({ node: 'pve2', ip: '10.0.0.12', host: '10.0.0.12', port: 2222, address_source: 'proxmox' })
  })
})

describe('POST /api/v1/connections/[id]/test-ssh - sudoers check', () => {
  const RULES = [
    { id: 'ui-guest-unlock', profile: 'node-ops', path: '/usr/sbin/qm', args: '^unlock [0-9]+$', usedBy: 'Unlock', example: 'unlock 100' },
    { id: 'sr-zfs', profile: 'site-recovery', path: '/usr/sbin/zfs', args: '^snapshot [a-z/@]+$', usedBy: 'ZFS', example: 'snapshot a/b@c' },
  ]

  function connection(sshUser: string, sshUseSudo: boolean) {
    return {
      id: 'conn-1', name: 'PVE', type: 'pve', baseUrl: 'https://10.0.0.1:8006',
      sshEnabled: true, sshPort: 22, sshUser, sshAuthMethod: 'password', sshKeyEnc: null, sshPassEnc: 'enc', sshUseSudo,
    }
  }

  it('checks every rule on each reachable node for a sudo account, and says when only the frontend rules were known', async () => {
    findUniqueMock.mockResolvedValueOnce(connection('proxcenter', true))
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, nodes: [{ node: 'pve1', ip: '10.0.0.1', status: 'ok' }, { node: 'pve2', ip: '10.0.0.2', status: 'error' }] }),
    })
    loadSudoRulesMock.mockResolvedValueOnce({ rules: RULES, orchestratorAvailable: false })
    executeSSHDirectMock.mockResolvedValueOnce({
      success: true,
      output: 'PXC_SUDO_VERSION:Sudo version 1.9.16p2\nPXC_RULE:ui-guest-unlock:yes\nPXC_RULE:sr-zfs:no\nPXC_RULE:pxc-migrations:no\n',
    } as any)

    const res = await callRoute(await importHandler(), { params: { id: 'conn-1' }, body: {} })
    const json = await readJson<any>(res)

    expect(executeSSHDirectMock).toHaveBeenCalledTimes(1)
    const opts = executeSSHDirectMock.mock.calls[0][0]

    expect(opts).toMatchObject({ host: '10.0.0.1', user: 'proxcenter' })
    expect(opts.command).toContain("pxc_r 'ui-guest-unlock' '/usr/sbin/qm' 'unlock' '100'")
    expect(json.sudoRulesPartial).toBe(true)
    expect(json.nodes[0].sudoCheck).toEqual({
      status: 'ok',
      version: 'Sudo version 1.9.16p2',
      profiles: {
        'node-ops': { checked: 1, missing: [] },
        'site-recovery': { checked: 1, missing: [{ id: 'sr-zfs', usedBy: 'ZFS' }] },
        migrations: { checked: 1, missing: [{ id: 'pxc-migrations', usedBy: 'Migrations' }] },
      },
    })
    expect(json.nodes[1].sudoCheck).toBeUndefined()
  })

  it('does not check sudo for root', async () => {
    findUniqueMock.mockResolvedValueOnce(connection('root', true))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, nodes: [{ node: 'pve1', ip: '10.0.0.1', status: 'ok' }] }) })

    const json = await readJson<any>(await callRoute(await importHandler(), { params: { id: 'conn-1' }, body: {} }))

    expect(executeSSHDirectMock).not.toHaveBeenCalled()
    expect(loadSudoRulesMock).not.toHaveBeenCalled()
    expect(json.nodes[0].sudoCheck).toBeUndefined()
    expect(json.sudoSkipped).toBe('root')
  })

  it('says nothing about sudo for root when the switch is off', async () => {
    findUniqueMock.mockResolvedValueOnce(connection('root', false))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, nodes: [{ node: 'pve1', ip: '10.0.0.1', status: 'ok' }] }) })

    const json = await readJson<any>(await callRoute(await importHandler(), { params: { id: 'conn-1' }, body: {} }))

    expect(json.sudoSkipped).toBeUndefined()
  })
})
