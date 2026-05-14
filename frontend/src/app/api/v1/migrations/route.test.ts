import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const findUniqueMock = vi.fn<(args: any) => Promise<any>>()
const findManyMock = vi.fn<(args: any) => Promise<any[]>>()
const createMock = vi.fn<(args: any) => Promise<any>>()

const runMigrationPipelineMock = vi.fn<(...args: any[]) => Promise<void>>()
const runXcpngMigrationPipelineMock = vi.fn<(...args: any[]) => Promise<void>>()
const runV2vMigrationPipelineMock = vi.fn<(...args: any[]) => Promise<void>>()

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: { findUnique: findUniqueMock },
    migrationJob: { create: createMock, findMany: findManyMock },
  }),
  getCurrentTenantId: async () => 'default',
  getTenantPrisma: () => ({
    connection: { findUnique: findUniqueMock },
  }),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { VM_MIGRATE: 'vm.migrate' },
}))

vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

vi.mock('next-auth', () => ({
  getServerSession: async () => ({ user: { id: 'user-1' } }),
}))

vi.mock('@/lib/migration/pipeline', () => ({
  runMigrationPipeline: runMigrationPipelineMock,
}))

vi.mock('@/lib/migration/xcpng-pipeline', () => ({
  runXcpngMigrationPipeline: runXcpngMigrationPipelineMock,
}))

vi.mock('@/lib/migration/v2v-pipeline', () => ({
  runV2vMigrationPipeline: runV2vMigrationPipelineMock,
}))

vi.mock('@/lib/vmware/soap', () => ({
  soapLogin: vi.fn().mockResolvedValue({}),
  soapLogout: vi.fn().mockResolvedValue(undefined),
  soapGetVmConfig: vi.fn().mockResolvedValue(''),
  parseVmConfig: vi.fn().mockReturnValue({ guestOS: 'linux', guestId: 'linux', vmPathName: '' }),
}))

vi.mock('@/lib/crypto/secret', () => ({
  decryptSecret: (s: string) => `decrypted:${s}`,
}))

// next/server's `after` runs the callback after the response. In tests
// there is no runtime to flush it, so we stub it as a no-op to keep the
// pipeline mocks from being invoked by an in-process flush.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')

  return {
    ...actual,
    after: (_fn: () => void) => {},
  }
})

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  findUniqueMock.mockReset()
  findManyMock.mockReset().mockResolvedValue([])
  createMock.mockReset().mockResolvedValue({ id: 'job-1' })
  runMigrationPipelineMock.mockReset().mockResolvedValue(undefined)
  runXcpngMigrationPipelineMock.mockReset().mockResolvedValue(undefined)
  runV2vMigrationPipelineMock.mockReset().mockResolvedValue(undefined)
})

async function importPOST() {
  const mod = await import('./route')
  return mod.POST
}

const baseBody = {
  sourceConnectionId: 'src-1',
  sourceVmId: 'vm-100',
  targetConnectionId: 'tgt-1',
  targetNode: 'pve1',
  targetStorage: 'local-lvm',
  networkBridge: 'vmbr0',
}

function stubConnections({
  source = { id: 'src-1', type: 'vmware', subType: 'esxi', name: 'ESXi', baseUrl: 'https://esxi.lab' },
  target = { id: 'tgt-1', type: 'pve', name: 'PVE' },
}: { source?: any; target?: any } = {}) {
  findUniqueMock
    .mockResolvedValueOnce(source)  // sourceConn
    .mockResolvedValueOnce(target)  // pveConn
}

describe('POST /api/v1/migrations - guards', () => {
  it('returns 403 when RBAC denies vm.migrate', async () => {
    const denied = new Response(JSON.stringify({ error: 'no' }), { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const POST = await importPOST()
    const res = await callRoute(POST, { body: baseBody })

    expect(res.status).toBe(403)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is not JSON', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: 'oops',
      headers: { 'content-type': 'application/json' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('Invalid JSON')
  })

  it.each([
    ['sourceConnectionId'],
    ['sourceVmId'],
    ['targetConnectionId'],
    ['targetNode'],
    ['targetStorage'],
  ])('returns 400 when required field %s is missing', async (field) => {
    const body = { ...baseBody, [field]: undefined }
    const POST = await importPOST()
    const res = await callRoute(POST, { body })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('Missing required fields')
  })
})

describe('POST /api/v1/migrations - input validation against shell injection', () => {
  it('rejects an injection attempt in targetNode', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: { ...baseBody, targetNode: 'pve1; rm -rf /' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/Invalid node name/i)
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('rejects an injection attempt in targetStorage', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: { ...baseBody, targetStorage: 'local$(whoami)' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/Invalid storage name/i)
  })

  it('rejects an injection attempt in networkBridge', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: { ...baseBody, networkBridge: 'vmbr0|cat' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/Invalid bridge name/i)
  })

  it('rejects a relative tempStorage path (must be absolute)', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: { ...baseBody, tempStorage: 'relative/path' },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/Invalid absolute path/i)
  })

  it('rejects targetVmid below the 100 floor', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: { ...baseBody, targetVmid: 99 },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/targetVmid must be an integer/i)
  })

  it('rejects vlanTag outside 1-4094', async () => {
    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: { ...baseBody, vlanTag: 5000 },
    })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toMatch(/vlanTag must be an integer between 1 and 4094/i)
  })

  it('accepts vlanTag as a string and coerces it to a number', async () => {
    stubConnections()

    const POST = await importPOST()
    const res = await callRoute(POST, {
      body: { ...baseBody, vlanTag: '42' },
    })

    expect(res.status).toBe(200)
    const savedConfig = createMock.mock.calls[0][0].data.config
    expect(savedConfig.vlanTag).toBe(42)
  })
})

describe('POST /api/v1/migrations - connection type checks', () => {
  it('returns 404 when the source connection is missing', async () => {
    findUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tgt-1', type: 'pve', name: 'PVE' })

    const POST = await importPOST()
    const res = await callRoute(POST, { body: baseBody })

    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toMatch(/Source hypervisor/i)
  })

  it('rejects a PVE source connection (must be vmware/xcpng/hyperv/nutanix)', async () => {
    stubConnections({
      source: { id: 'src-1', type: 'pve', name: 'PVE-src', baseUrl: 'x' },
    })

    const POST = await importPOST()
    const res = await callRoute(POST, { body: baseBody })

    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toMatch(/Source hypervisor/i)
  })

  it('returns 404 when the target connection is not PVE', async () => {
    stubConnections({
      target: { id: 'tgt-1', type: 'pbs', name: 'PBS' },
    })

    const POST = await importPOST()
    const res = await callRoute(POST, { body: baseBody })

    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toMatch(/Proxmox connection/i)
  })
})

describe('POST /api/v1/migrations - happy path and routing decision', () => {
  it('creates a job with status="pending" and returns the job id (200)', async () => {
    stubConnections()
    createMock.mockResolvedValueOnce({ id: 'job-xyz' })

    const POST = await importPOST()
    const res = await callRoute(POST, { body: baseBody })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toEqual({ jobId: 'job-xyz', status: 'pending' })

    expect(createMock).toHaveBeenCalledTimes(1)
    const created = createMock.mock.calls[0][0].data
    expect(created.status).toBe('pending')
    expect(created.targetNode).toBe('pve1')
    expect(created.config.sourceType).toBe('vmware')
  })

  it('marks the effective source type as "vcenter" when the source is vmware with subType=vcenter', async () => {
    stubConnections({
      source: { id: 'src-1', type: 'vmware', subType: 'vcenter', name: 'vCenter', baseUrl: 'https://vc.lab' },
    })

    const POST = await importPOST()
    await callRoute(POST, { body: baseBody })

    expect(createMock.mock.calls[0][0].data.config.sourceType).toBe('vcenter')
  })

  it('persists the optional targetVmid into the job config', async () => {
    stubConnections()

    const POST = await importPOST()
    await callRoute(POST, { body: { ...baseBody, targetVmid: 250 } })

    expect(createMock.mock.calls[0][0].data.config.targetVmid).toBe(250)
  })

  it('records the createdBy user id from the NextAuth session', async () => {
    stubConnections()

    const POST = await importPOST()
    await callRoute(POST, { body: baseBody })

    expect(createMock.mock.calls[0][0].data.createdBy).toBe('user-1')
  })
})
