import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// Provider or MSP tenant: the IaaS Ceph gate lets the caller through (its own tests: lib/ceph/tenantGuard*.test.ts).
vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: async () => null }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
  isConnectionNotFoundError: (err: unknown) =>
    /connection not found/i.test((err as { message?: string } | null)?.message || ''),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...a: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))
vi.mock('@/lib/ceph/exporter', async () => ({
  ...(await vi.importActual<typeof import('@/lib/ceph/exporter')>('@/lib/ceph/exporter')),
  fetchExporterMetrics: vi.fn<(...a: any[]) => Promise<string>>(),
  getExporterPort: vi.fn<(...a: any[]) => Promise<number>>(),
}))

import { GET } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { clearNodeIpCache, fetchExporterMetrics, getExporterPort } from '@/lib/ceph/exporter'

const pveFetchMock = pveFetch as any
const fetchMetrics = fetchExporterMetrics as any

const STATUS = [
  { type: 'cluster', name: 'lab' },
  { type: 'node', name: 'pve1', ip: '10.0.0.1', online: 1 },
  { type: 'node', name: 'pve2', ip: '10.0.0.2', online: 1 },
]
const TEXT = [
  'ceph_osd_op_r{ceph_daemon="osd.0"} 10',
  'ceph_osd_op_w{ceph_daemon="osd.0"} 20',
  'ceph_osd_op_r_out_bytes{ceph_daemon="osd.0"} 30',
  'ceph_osd_op_w_in_bytes{ceph_daemon="osd.0"} 40',
].join('\n')

const call = (params: Record<string, string>, searchParams: Record<string, string> = { osd: '0' }) =>
  callRoute(GET as any, { params, searchParams })

beforeEach(() => {
  vi.clearAllMocks()
  clearNodeIpCache()
  ;(checkPermission as any).mockResolvedValue(null)
  ;(getConnectionById as any).mockResolvedValue({ id: 'c1' })
  ;(getExporterPort as any).mockResolvedValue(9926)
  pveFetchMock.mockResolvedValue(STATUS)
  fetchMetrics.mockResolvedValue(TEXT)
})

describe('GET /connections/[id]/nodes/[node]/ceph/exporter', () => {
  it('answers the four counters of the OSD, read at the PVE address and the connection port', async () => {
    ;(getExporterPort as any).mockResolvedValue(9100)
    const res = await call({ id: 'c1', node: 'pve1' })
    expect(res.status).toBe(200)
    const { data } = await readJson<any>(res)
    expect(data).toEqual({ osd: 0, at: expect.any(Number), op_r: 10, op_w: 20, op_r_out_bytes: 30, op_w_in_bytes: 40 })
    expect(fetchMetrics).toHaveBeenCalledWith('10.0.0.1', 9100)
  })

  it('asks PVE once for several readings (address cache)', async () => {
    await call({ id: 'c1', node: 'pve1' })
    await call({ id: 'c1', node: 'pve2' })
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(pveFetchMock.mock.calls[0][1]).toBe('/cluster/status')
  })

  it('refuses without the view permission, before any read', async () => {
    ;(checkPermission as any).mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))
    const res = await call({ id: 'c1', node: 'pve1' })
    expect(res.status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith('connection.view', 'connection', 'c1')
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(fetchMetrics).not.toHaveBeenCalled()
  })

  it('400 on an invalid node name or osd, nothing fetched', async () => {
    expect((await call({ id: 'c1', node: 'a;b' })).status).toBe(400)
    expect((await call({ id: 'c1', node: 'pve1' }, {})).status).toBe(400)
    expect((await call({ id: 'c1', node: 'pve1' }, { osd: '-1' })).status).toBe(400)
    expect((await call({ id: 'c1', node: 'pve1' }, { osd: 'x' })).status).toBe(400)
    expect(fetchMetrics).not.toHaveBeenCalled()
  })

  it('404 for a node that is not a member of the connection, never fetching it', async () => {
    const res = await call({ id: 'c1', node: 'other' })
    expect(res.status).toBe(404)
    expect(fetchMetrics).not.toHaveBeenCalled()
  })

  it('503 exporter_unreachable on any fetch failure, without the raw error', async () => {
    fetchMetrics.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:9926'))
    const res = await call({ id: 'c1', node: 'pve1' })
    expect(res.status).toBe(503)
    const body = await readJson<any>(res)
    expect(body.code).toBe('exporter_unreachable')
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/)
  })

  it('503 carries the reason of the failure: refused, timeout or invalid', async () => {
    const cases: [unknown, string][] = [
      [new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }), 'refused'],
      [new DOMException('The operation was aborted due to timeout', 'TimeoutError'), 'timeout'],
      [new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } }), 'timeout'],
      [new Error('exporter answered 404'), 'invalid'],
    ]
    for (const [err, reason] of cases) {
      fetchMetrics.mockRejectedValueOnce(err)
      const res = await call({ id: 'c1', node: 'pve1' })
      expect(res.status).toBe(503)
      const body = await readJson<any>(res)
      expect(body).toMatchObject({ code: 'exporter_unreachable', reason })
      expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|EHOSTUNREACH|10\.0\.0\.1|aborted|answered/)
    }
  })

  it('404 osd_not_exported when the exporter does not report the OSD', async () => {
    const res = await call({ id: 'c1', node: 'pve1' }, { osd: '7' })
    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).code).toBe('osd_not_exported')
  })

  it('404 for an unknown connection and 500 (generic) for a PVE failure', async () => {
    ;(getConnectionById as any).mockRejectedValue(new Error('Connection not found: c1'))
    expect((await call({ id: 'c1', node: 'pve1' })).status).toBe(404)
    ;(getConnectionById as any).mockResolvedValue({ id: 'c1' })
    pveFetchMock.mockRejectedValue(new Error('secret token abc'))
    const res = await call({ id: 'c1', node: 'pve1' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await readJson<any>(res))).not.toMatch(/secret/)
  })

  it('404 for a connection of another tenant, before any address is read or fetched', async () => {
    ;(getConnectionById as any).mockRejectedValue(new Error('Connection not found: c1'))
    const res = await call({ id: 'c1', node: 'pve1' })
    expect(res.status).toBe(404)
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(fetchMetrics).not.toHaveBeenCalled()
  })
})
