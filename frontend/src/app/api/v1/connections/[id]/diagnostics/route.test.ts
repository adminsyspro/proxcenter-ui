// src/app/api/v1/connections/[id]/diagnostics/route.test.ts
//
// Mock-based tests for the GET /api/v1/connections/[id]/diagnostics route.

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string, tenantId?: string) => Promise<any>>()
const getPbsConnectionByIdMock = vi.fn<(id: string, tenantId?: string) => Promise<any>>()
const runConnectionDiagnosticsMock = vi.fn<(...args: any[]) => Promise<any>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()
const getNodeIpMock = vi.fn<(...args: any[]) => Promise<string>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const decryptSecretMock = vi.fn<(s: string) => string>()
const getTenantInfrastructureScopeMock = vi.fn<(tenantId: string) => Promise<any>>()

const findUniqueMock = vi.fn<(args: any) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
    CONNECTION_MANAGE: 'connection.manage',
    BACKUP_VIEW: 'backup.view',
  },
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: getCurrentTenantIdMock,
}))

vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    connection: {
      findUnique: findUniqueMock,
    },
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
  getPbsConnectionById: getPbsConnectionByIdMock,
}))

vi.mock('@/lib/diagnostics/connectionDiagnostics', () => ({
  runConnectionDiagnostics: runConnectionDiagnosticsMock,
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: getNodeIpMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('@/lib/crypto/secret', () => ({
  decryptSecret: decryptSecretMock,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides?: Record<string, any>) {
  return {
    connectionId: 'c1',
    type: 'pve',
    checks: [],
    summary: { ok: 0, warn: 0, error: 0, skip: 0 },
    ranAt: '2026-01-01T00:00:00.000Z',
    durationMs: 42,
    ...overrides,
  }
}

function makePveRow(overrides?: Record<string, any>) {
  return {
    id: 'c1',
    type: 'pve',
    name: 'Test PVE',
    baseUrl: 'https://10.0.0.1:8006',
    hasCeph: false,
    sshEnabled: false,
    sshPort: 22,
    sshUser: 'root',
    sshAuthMethod: null,
    sshKeyEnc: null,
    sshPassEnc: null,
    tenantId: 'owner-tenant',
    ...overrides,
  }
}

async function importGET() {
  const mod = await import('./route')
  return mod.GET as Parameters<typeof callRoute>[0]
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getCurrentTenantIdMock.mockReset().mockResolvedValue('owner-tenant')
  // Default: provider scope (can see all connections)
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  // Default: return a PVE row for both the slim type-lookup and the full row lookup.
  // Tests that need a specific row shape call mockResolvedValueOnce() twice in a row
  // (first for the slim lookup, second for the full lookup), or call
  // mockImplementation() to vary by call argument.
  findUniqueMock.mockReset().mockResolvedValue(makePveRow())
  getConnectionByIdMock.mockReset().mockResolvedValue({ baseUrl: 'https://10.0.0.1:8006', apiToken: 'tok=secret', id: 'c1' })
  getPbsConnectionByIdMock.mockReset().mockResolvedValue({ baseUrl: 'https://10.0.0.2:8007', apiToken: 'tok:secret', id: 'c2' })
  runConnectionDiagnosticsMock.mockReset().mockResolvedValue(makeReport())
  getNodeIpMock.mockReset().mockResolvedValue('10.0.0.1')
  pveFetchMock.mockReset().mockResolvedValue([])
  decryptSecretMock.mockReset().mockImplementation((s: string) => `decrypted:${s}`)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/connections/[id]/diagnostics', () => {
  it('returns 400 when params.id is missing', async () => {
    const GET = await importGET()
    const res = await callRoute(GET, { params: {} })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toBe('Missing params.id')
  })

  it('honours RBAC denial after the slim type lookup', async () => {
    // The route fetches the connection type before running the permission check
    // so it can pick the correct resource type (pbs vs connection). The full
    // row lookup (and everything downstream) must NOT happen when denied.
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(403)
    // The slim type lookup fires exactly once; the full row lookup must not.
    expect(findUniqueMock).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when the connection does not exist', async () => {
    findUniqueMock.mockResolvedValueOnce(null)

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'gone' } })

    expect(res.status).toBe(404)
    expect((await readJson<any>(res))?.error).toContain('not found')
  })

  // -------------------------------------------------------------------------
  // Access gate: provider / MSP / iaas
  // -------------------------------------------------------------------------

  it('returns 200 for provider tenant regardless of connection owner', async () => {
    getCurrentTenantIdMock.mockResolvedValue('provider-tenant')
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    const row = makePveRow({ tenantId: 'some-msp-tenant' })
    findUniqueMock.mockResolvedValue(row)
    const expectedReport = makeReport({ connectionId: 'c1', type: 'pve' })
    runConnectionDiagnosticsMock.mockResolvedValueOnce(expectedReport)

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body?.connectionId).toBe('c1')
  })

  it('provider loader passes the row tenantId to getConnectionById (cross-tenant NOC)', async () => {
    getCurrentTenantIdMock.mockResolvedValue('provider-tenant')
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    // Connection is owned by an MSP tenant, not the provider
    const row = makePveRow({ tenantId: 'msp-tenant-42' })
    findUniqueMock.mockResolvedValue(row)

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    // The loader must use the row's tenantId, not the provider's session tenantId
    expect(getConnectionByIdMock).toHaveBeenCalledWith('c1', 'msp-tenant-42')
  })

  it('provider loader passes the row tenantId to getPbsConnectionById (cross-tenant NOC)', async () => {
    getCurrentTenantIdMock.mockResolvedValue('provider-tenant')
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    const row = makePveRow({ id: 'c2', type: 'pbs', tenantId: 'msp-tenant-42' })
    findUniqueMock.mockResolvedValue(row)
    runConnectionDiagnosticsMock.mockResolvedValueOnce(makeReport({ connectionId: 'c2', type: 'pbs' }))

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c2' } })

    expect(getPbsConnectionByIdMock).toHaveBeenCalledWith('c2', 'msp-tenant-42')
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('returns 200 for an MSP tenant that owns the connection', async () => {
    getCurrentTenantIdMock.mockResolvedValue('msp-tenant-1')
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['c1', 'c99']),
    })
    findUniqueMock.mockResolvedValue(makePveRow({ tenantId: 'msp-tenant-1' }))
    runConnectionDiagnosticsMock.mockResolvedValueOnce(makeReport())

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(200)
  })

  it('MSP loader passes the row tenantId to getConnectionById', async () => {
    getCurrentTenantIdMock.mockResolvedValue('msp-tenant-1')
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['c1']),
    })
    findUniqueMock.mockResolvedValue(makePveRow({ tenantId: 'msp-tenant-1' }))

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    expect(getConnectionByIdMock).toHaveBeenCalledWith('c1', 'msp-tenant-1')
  })

  it('returns 403 for an MSP tenant that does NOT own the connection', async () => {
    getCurrentTenantIdMock.mockResolvedValue('msp-tenant-other')
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['c99']), // c1 is not in the set
    })
    findUniqueMock.mockResolvedValue(makePveRow({ tenantId: 'msp-tenant-1' }))

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(403)
    const body = await readJson<any>(res)
    expect(body?.error).toContain('provider or the owning MSP tenant')
  })

  it('returns 403 for an iaas/vDC tenant', async () => {
    getCurrentTenantIdMock.mockResolvedValue('iaas-tenant')
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: { connectionIds: new Set(['c1']), pbsConnectionIds: new Set<string>() },
    })
    findUniqueMock.mockResolvedValue(makePveRow({ tenantId: 'owner-tenant' }))

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(403)
    const body = await readJson<any>(res)
    expect(body?.error).toContain('provider or the owning MSP tenant')
  })

  // -------------------------------------------------------------------------
  // Existing behaviour preserved
  // -------------------------------------------------------------------------

  it('returns 200 with a report shape on a valid PVE connection', async () => {
    // beforeEach default (makePveRow) covers both slim + full lookups
    const expectedReport = makeReport({ connectionId: 'c1', type: 'pve' })
    runConnectionDiagnosticsMock.mockResolvedValueOnce(expectedReport)

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body?.connectionId).toBe('c1')
    expect(body?.type).toBe('pve')
    expect(Array.isArray(body?.checks)).toBe(true)
    expect(body?.summary).toMatchObject({ ok: 0, warn: 0, error: 0, skip: 0 })
  })

  it('calls getConnectionById for a PVE connection with the row tenantId', async () => {
    findUniqueMock.mockResolvedValue(makePveRow({ type: 'pve', tenantId: 'owner-tenant' }))

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    expect(getConnectionByIdMock).toHaveBeenCalledWith('c1', 'owner-tenant')
    expect(getPbsConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('calls getPbsConnectionById for a PBS connection with the row tenantId', async () => {
    const row = makePveRow({ id: 'c2', type: 'pbs', tenantId: 'owner-tenant' })
    findUniqueMock.mockResolvedValue(row)
    runConnectionDiagnosticsMock.mockResolvedValueOnce(makeReport({ connectionId: 'c2', type: 'pbs' }))

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c2' } })

    expect(getPbsConnectionByIdMock).toHaveBeenCalledWith('c2', 'owner-tenant')
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('passes hasCeph and sshEnabled metadata to runConnectionDiagnostics', async () => {
    findUniqueMock.mockResolvedValue(makePveRow({ hasCeph: true, sshEnabled: true, sshAuthMethod: 'password', sshPassEnc: 'enc-pw' }))

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    const [meta] = runConnectionDiagnosticsMock.mock.calls[0]
    expect(meta.hasCeph).toBe(true)
    expect(meta.sshEnabled).toBe(true)
    expect(meta.type).toBe('pve')
  })

  it('decrypts SSH password when sshEnabled and no sshKeyEnc (password auth)', async () => {
    findUniqueMock.mockResolvedValue(
      makePveRow({ sshEnabled: true, sshAuthMethod: 'password', sshPassEnc: 'enc-pw', sshKeyEnc: null }),
    )

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    expect(decryptSecretMock).toHaveBeenCalledWith('enc-pw')
    const [meta] = runConnectionDiagnosticsMock.mock.calls[0]
    expect(meta.sshPassword).toBe('decrypted:enc-pw')
    expect(meta.sshKey).toBeUndefined()
  })

  it('decrypts SSH key when sshAuthMethod is key', async () => {
    findUniqueMock.mockResolvedValue(
      makePveRow({ sshEnabled: true, sshAuthMethod: 'key', sshKeyEnc: 'enc-key' }),
    )

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    expect(decryptSecretMock).toHaveBeenCalledWith('enc-key')
    const [meta] = runConnectionDiagnosticsMock.mock.calls[0]
    expect(meta.sshKey).toBe('decrypted:enc-key')
  })

  it('passes baseUrl into meta for external connection types', async () => {
    findUniqueMock.mockResolvedValue(
      makePveRow({ id: 'ext1', type: 'vmware', baseUrl: 'https://vcenter.example.com:443' }),
    )
    runConnectionDiagnosticsMock.mockResolvedValueOnce(makeReport({ connectionId: 'ext1', type: 'vmware' }))

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'ext1' } })

    const [meta] = runConnectionDiagnosticsMock.mock.calls[0]
    expect(meta.baseUrl).toBe('https://vcenter.example.com:443')
    expect(meta.type).toBe('vmware')
    // External types must NOT trigger connection client loaders.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(getPbsConnectionByIdMock).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // canManage wiring
  // -------------------------------------------------------------------------

  it('forwards canManage:true into meta when CONNECTION_MANAGE check returns null', async () => {
    // All permission checks return null (allowed); beforeEach default covers the DB
    checkPermissionMock.mockResolvedValue(null)

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    const [meta] = runConnectionDiagnosticsMock.mock.calls[0]
    expect(meta.canManage).toBe(true)
  })

  it('forwards canManage:false into meta when CONNECTION_MANAGE check returns a denial Response, and the route still returns 200', async () => {
    // VIEW allowed, MANAGE denied
    const manageDenied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockImplementation(async (_perm: string) => {
      if (_perm === 'connection.manage') return manageDenied as any
      return null
    })
    runConnectionDiagnosticsMock.mockResolvedValueOnce(makeReport())

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(200)
    const [meta] = runConnectionDiagnosticsMock.mock.calls[0]
    expect(meta.canManage).toBe(false)
  })

  it('returns 500 on unexpected route-level error', async () => {
    findUniqueMock.mockRejectedValueOnce(new Error('DB down'))

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body?.error).toContain('DB down')
  })

  // -------------------------------------------------------------------------
  // Fix 1: type-aware permission (PBS -> BACKUP_VIEW/"pbs")
  // -------------------------------------------------------------------------

  it('PBS connection: denied when BACKUP_VIEW is refused, returns 403', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    // Slim type lookup returns PBS; BACKUP_VIEW check returns denial
    const pbsRow = makePveRow({ type: 'pbs', tenantId: 'owner-tenant' })
    findUniqueMock.mockResolvedValue(pbsRow)
    checkPermissionMock.mockImplementation(async (perm: string) => {
      if (perm === 'backup.view') return denied as any
      return null
    })

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'pbs1' } })

    expect(res.status).toBe(403)
    // Must have checked BACKUP_VIEW, not CONNECTION_VIEW
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.view', 'pbs', 'pbs1')
    expect(checkPermissionMock).not.toHaveBeenCalledWith('connection.view', 'connection', 'pbs1')
  })

  it('PBS connection: allowed when BACKUP_VIEW passes, returns 200', async () => {
    const pbsRow = makePveRow({ id: 'pbs1', type: 'pbs', tenantId: 'owner-tenant' })
    findUniqueMock.mockResolvedValue(pbsRow)
    checkPermissionMock.mockResolvedValue(null)
    runConnectionDiagnosticsMock.mockResolvedValueOnce(makeReport({ connectionId: 'pbs1', type: 'pbs' }))

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'pbs1' } })

    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.view', 'pbs', 'pbs1')
    expect(checkPermissionMock).not.toHaveBeenCalledWith('connection.view', 'connection', 'pbs1')
  })

  it('PVE connection: still uses CONNECTION_VIEW/"connection" (not affected by PBS change)', async () => {
    // beforeEach default is a pve row
    checkPermissionMock.mockResolvedValue(null)

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    expect(checkPermissionMock).toHaveBeenCalledWith('connection.view', 'connection', 'c1')
    expect(checkPermissionMock).not.toHaveBeenCalledWith('backup.view', 'pbs', 'c1')
  })

  // -------------------------------------------------------------------------
  // Fix 2: SSH key auth derived from sshKeyEnc presence (legacy rows)
  // -------------------------------------------------------------------------

  it('legacy row with sshKeyEnc set and sshAuthMethod null uses key auth (sshPassEnc as passphrase)', async () => {
    // sshAuthMethod is null but sshKeyEnc is populated -- legacy row
    findUniqueMock.mockResolvedValue(
      makePveRow({
        sshEnabled: true,
        sshAuthMethod: null,
        sshKeyEnc: 'enc-legacy-key',
        sshPassEnc: 'enc-legacy-passphrase',
      }),
    )

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    // Must have decrypted the key
    expect(decryptSecretMock).toHaveBeenCalledWith('enc-legacy-key')
    // sshPassEnc must be treated as a passphrase, not a password
    expect(decryptSecretMock).toHaveBeenCalledWith('enc-legacy-passphrase')

    const [meta] = runConnectionDiagnosticsMock.mock.calls[0]
    expect(meta.sshKey).toBe('decrypted:enc-legacy-key')
    expect(meta.sshPassphrase).toBe('decrypted:enc-legacy-passphrase')
    // Must NOT have set sshPassword
    expect(meta.sshPassword).toBeUndefined()
  })

  it('legacy row with sshKeyEnc set and sshAuthMethod null ignores sshPassEnc as password', async () => {
    // Variant: no sshPassEnc -- just the key, no passphrase
    findUniqueMock.mockResolvedValue(
      makePveRow({
        sshEnabled: true,
        sshAuthMethod: null,
        sshKeyEnc: 'enc-key-only',
        sshPassEnc: null,
      }),
    )

    const GET = await importGET()
    await callRoute(GET, { params: { id: 'c1' } })

    const [meta] = runConnectionDiagnosticsMock.mock.calls[0]
    expect(meta.sshKey).toBe('decrypted:enc-key-only')
    expect(meta.sshPassphrase).toBeUndefined()
    expect(meta.sshPassword).toBeUndefined()
  })
})
