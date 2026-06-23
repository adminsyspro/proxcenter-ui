import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { FRAMEWORK_IDS } from '@/lib/compliance/frameworks/types'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const findUniqueMock = vi.fn<(args: any) => Promise<any>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const verifyConnectionOwnershipMock = vi.fn<(id: string) => Promise<Response | null>>()
const collectHardeningDataMock = vi.fn<(opts: any) => Promise<any>>()
const requireEnterpriseMock = vi.fn<() => Promise<Response | null>>()

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: { findUnique: findUniqueMock },
  }),
  verifyConnectionOwnership: verifyConnectionOwnershipMock,
  getCurrentTenantId: vi.fn(async () => 'tenant-1'),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_COMPLIANCE: 'admin.compliance' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/compliance/collectHardeningData', () => ({
  collectHardeningData: collectHardeningDataMock,
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireEnterprise: requireEnterpriseMock,
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/compliance/frameworks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: enterprise permitted, RBAC permitted, ownership OK
    requireEnterpriseMock.mockResolvedValue(null)
    checkPermissionMock.mockResolvedValue(null)
    verifyConnectionOwnershipMock.mockResolvedValue(null)
    getConnectionByIdMock.mockResolvedValue({ id: 'conn-1', name: 'Test Cluster' })
    findUniqueMock.mockResolvedValue({ sshEnabled: false })
    // collectHardeningData returns minimal HardeningData with one node so nodes[] is populated
    collectHardeningDataMock.mockResolvedValue({
      nodes: [{ node: 'pve1', status: 'online' }],
    })
  })

  it('returns 200 with assessments for all registered frameworks (enterprise + permitted)', async () => {
    const { GET } = await import('./route')

    const res = await callRoute(GET, { searchParams: { connectionId: 'conn-1' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toHaveLength(FRAMEWORK_IDS.length)
    expect(body.data[0]).toHaveProperty('score')
    expect(body.data[0]).toHaveProperty('frameworkId')
    expect(body.data[0]).toHaveProperty('controls')
    // Every registered framework ID is present
    const ids = body.data.map((a: any) => a.frameworkId)
    for (const id of FRAMEWORK_IDS) expect(ids).toContain(id)
    // Per-node breakdown: nodes array present with one entry per node in hardeningData
    expect(Array.isArray(body.nodes)).toBe(true)
    expect(body.nodes).toHaveLength(1)
    expect(body.nodes[0]).toHaveProperty('node', 'pve1')
    expect(Array.isArray(body.nodes[0].checks)).toBe(true)
  })

  it('returns 400 when connectionId is missing', async () => {
    const { GET } = await import('./route')

    const res = await callRoute(GET, {})

    expect(res.status).toBe(400)
  })

  it('returns 403 when requireEnterprise denies', async () => {
    const { NextResponse } = await import('next/server')
    requireEnterpriseMock.mockResolvedValue(
      NextResponse.json({ error: 'Enterprise feature' }, { status: 403 })
    )

    const { GET } = await import('./route')

    const res = await callRoute(GET, { searchParams: { connectionId: 'conn-1' } })

    expect(res.status).toBe(403)
  })

  it('returns 403 when RBAC checkPermission denies', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    )

    const { GET } = await import('./route')

    const res = await callRoute(GET, { searchParams: { connectionId: 'conn-1' } })

    expect(res.status).toBe(403)
  })

  it('returns ownership error when verifyConnectionOwnership denies', async () => {
    const { NextResponse } = await import('next/server')
    verifyConnectionOwnershipMock.mockResolvedValue(
      NextResponse.json({ error: 'Not found' }, { status: 404 })
    )

    const { GET } = await import('./route')

    const res = await callRoute(GET, { searchParams: { connectionId: 'conn-1' } })

    expect(res.status).toBe(404)
  })

  it('passes sshEnabled from prisma to collectHardeningData', async () => {
    findUniqueMock.mockResolvedValue({ sshEnabled: true })

    const { GET } = await import('./route')

    await callRoute(GET, { searchParams: { connectionId: 'conn-1' } })

    expect(collectHardeningDataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        sshEnabled: true,
      })
    )
  })
})
