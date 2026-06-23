import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const findUniqueMock = vi.fn<(args: any) => Promise<any>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const verifyConnectionOwnershipMock = vi.fn<(id: string) => Promise<Response | null>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()
const getActiveProfileMock = vi.fn<(connId: string, tenantId: string) => Promise<any>>()
const getProfileMock = vi.fn<(id: string, tenantId: string) => Promise<any>>()
const getProfileChecksMock = vi.fn<(id: string, tenantId: string) => Promise<any[]>>()
const executeSSHMock = vi.fn<(connId: string, ip: string, cmd: string) => Promise<any>>()
const getNodeIpMock = vi.fn<(conn: any, node: string) => Promise<string>>()

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: { findUnique: findUniqueMock },
  }),
  verifyConnectionOwnership: verifyConnectionOwnershipMock,
  getCurrentTenantId: getCurrentTenantIdMock,
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_COMPLIANCE: 'admin.compliance' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('@/lib/compliance/profiles', () => ({
  getProfile: getProfileMock,
  getProfileChecks: getProfileChecksMock,
  getActiveProfile: getActiveProfileMock,
}))

vi.mock('@/lib/demo/demo-api', () => ({
  demoResponse: () => null,
}))

vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: executeSSHMock,
}))

vi.mock('@/lib/ssh/node-ip', () => ({
  getNodeIp: getNodeIpMock,
}))

vi.mock('@/lib/compliance/ssh-checks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/compliance/ssh-checks')>()
  return {
    ...actual,
    buildSSHAuditCommand: () => 'audit-cmd',
    parseSSHAuditOutput: () => ({}),
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubPveFetch() {
  pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path === '/cluster/firewall/options') return { enable: 1 }
    if (path === '/version') return { version: '8.1.0' }
    if (path === '/nodes') return [{ node: 'pve1', status: 'online' }]
    if (path === '/access/users?full=1') return []
    if (path === '/cluster/resources') return []
    if (path === '/cluster/backup') return []
    if (path === '/cluster/ha/resources') return []
    if (path === '/cluster/replication') return []
    if (path === '/pools') return []
    if (path === '/access/tfa') return []
    if (path.includes('/subscription')) return { status: 'active', level: 'standard' }
    if (path.includes('/apt/repositories')) return {}
    if (path.includes('/certificates/info')) return []
    if (path.includes('/firewall/options')) return {}
    return {}
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/compliance/hardening/[connectionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkPermissionMock.mockResolvedValue(null)
    verifyConnectionOwnershipMock.mockResolvedValue(null)
    getConnectionByIdMock.mockResolvedValue({ id: 'conn-1', name: 'Test Cluster' })
    findUniqueMock.mockResolvedValue({ sshEnabled: false })
    getCurrentTenantIdMock.mockResolvedValue('tenant-1')
    getActiveProfileMock.mockResolvedValue(null)
    stubPveFetch()
  })

  it('returns 200 with checks and score (no profile)', async () => {
    const { GET } = await import('./route')

    const res = await callRoute(GET, {
      params: { connectionId: 'conn-1' },
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body).toMatchObject({
      connectionId: 'conn-1',
      connectionName: 'Test Cluster',
      profileId: null,
    })
    expect(Array.isArray(body.checks)).toBe(true)
    expect(typeof body.score).toBe('number')
    expect(body.sshStatus).toMatchObject({ enabled: false })
  })

  it('returns 403 when permission check fails', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
    const { GET } = await import('./route')

    const res = await callRoute(GET, {
      params: { connectionId: 'conn-1' },
    })

    expect(res.status).toBe(403)
  })

  it('filters checks to node scope when node param is set', async () => {
    const { GET } = await import('./route')

    const res = await callRoute(GET, {
      params: { connectionId: 'conn-1' },
      searchParams: { node: 'pve1' },
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.node).toBe('pve1')
    // All returned checks should belong to node-scoped categories only
    const nodeCategories = ['node', 'vm', 'os', 'ssh', 'network', 'services', 'filesystem', 'logging']
    for (const check of body.checks) {
      expect(nodeCategories).toContain(check.category)
    }
  })
})
