import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getVdcScopeMock = vi.fn<(tenantId?: string) => Promise<any>>()
const resolveManagementIpMock = vi.fn<(_: any) => string | null>()
const setNodeIpsMock = vi.fn<(...args: any[]) => void>()

const upsertMock = vi.fn().mockResolvedValue({})
const deleteManyMock = vi.fn().mockResolvedValue({ count: 0 })
const findManyMock = vi.fn().mockResolvedValue([])

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    managedHost: {
      upsert: upsertMock,
      deleteMany: deleteManyMock,
      findMany: findManyMock,
    },
  }),
  getCurrentTenantId: async () => 'tenant-1',
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { NODE_VIEW: 'node.view' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('@/lib/proxmox/resolveManagementIp', () => ({
  resolveManagementIp: resolveManagementIpMock,
}))

vi.mock('@/lib/proxmox/urlUtils', () => ({
  extractHostFromUrl: (u: string) => new URL(u).hostname,
  extractPortFromUrl: (u: string) => Number(new URL(u).port || 8006),
}))

vi.mock('@/lib/cache/nodeIpCache', () => ({
  setNodeIps: setNodeIpsMock,
}))

vi.mock('@/lib/vdc/scope', () => ({
  getVdcScope: getVdcScopeMock,
}))

const nodesCacheKey = '__proxcenter_nodes_response_cache__'

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({
    baseUrl: 'https://10.0.0.1:8006',
    apiToken: 'tok=secret',
  })
  pveFetchMock.mockReset()
  getVdcScopeMock.mockReset().mockResolvedValue(null)
  resolveManagementIpMock.mockReset().mockReturnValue('10.0.0.1')
  setNodeIpsMock.mockReset()
  upsertMock.mockClear()
  deleteManyMock.mockClear()
  findManyMock.mockClear()
  // Clear the in-module cache so each test sees a fresh fetch.
  delete (globalThis as any)[nodesCacheKey]
})

async function importGET() {
  const mod = await import('./route')
  return mod.GET as Parameters<typeof callRoute>[0]
}

describe('GET /api/v1/connections/[id]/nodes', () => {
  it('extracts the parsed pveversion from /status for each online node', async () => {
    pveFetchMock
      // /nodes
      .mockResolvedValueOnce([{ node: 'pve1', status: 'online' }])
      // /cluster/resources?type=node
      .mockResolvedValueOnce([])
      // /nodes/pve1/network
      .mockResolvedValueOnce([{ iface: 'vmbr0', type: 'bridge' }])
      // /nodes/pve1/status
      .mockResolvedValueOnce({
        pveversion: 'pve-manager/9.1.1/2a5fa54a8503f96d',
        memory: { used: 1024, total: 2048 },
      })

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].pveversion).toBe('9.1.1')
  })

  it('falls back to the raw pveversion when it does not contain a slash', async () => {
    pveFetchMock
      .mockResolvedValueOnce([{ node: 'pve1', status: 'online' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ pveversion: '9.1.1', memory: { used: 1, total: 2 } })

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    const body = await readJson<any>(res)
    expect(body.data[0].pveversion).toBe('9.1.1')
  })

  it('leaves pveversion null when /status omits the field', async () => {
    pveFetchMock
      .mockResolvedValueOnce([{ node: 'pve1', status: 'online' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ memory: { used: 1, total: 2 } })

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    const body = await readJson<any>(res)
    expect(body.data[0].pveversion).toBeNull()
  })

  it('skips the /status call entirely for offline nodes, leaving pveversion null', async () => {
    pveFetchMock
      .mockResolvedValueOnce([{ node: 'pve1', status: 'offline' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(null) // /network
    // No /status call expected for offline node

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    const body = await readJson<any>(res)
    expect(body.data[0].pveversion).toBeNull()
  })

  it('returns 400 when params.id is missing', async () => {
    const GET = await importGET()
    const res = await callRoute(GET, { params: {} })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res))?.error).toBe('Missing params.id')
  })

  it('honours an RBAC denial without contacting Proxmox', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const GET = await importGET()
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
