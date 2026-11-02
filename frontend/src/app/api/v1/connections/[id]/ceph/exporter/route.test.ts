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
import { clearNodeIpCache, ExporterError, fetchExporterMetrics, getExporterPort } from '@/lib/ceph/exporter'

const fetchMetrics = fetchExporterMetrics as any

const STATUS = [
  { type: 'node', name: 'pve1', ip: '10.0.0.1' },
  { type: 'node', name: 'pve2', ip: '10.0.0.2' },
  { type: 'node', name: 'pve3', ip: '10.0.0.3' },
]
const osdText = (id: number) => [
  `ceph_osd_op_r{ceph_daemon="osd.${id}"} ${id + 1}`,
  `ceph_osd_op_w{ceph_daemon="osd.${id}"} ${id + 2}`,
  `ceph_osd_op_r_out_bytes{ceph_daemon="osd.${id}"} ${id + 3}`,
  `ceph_osd_op_w_in_bytes{ceph_daemon="osd.${id}"} ${id + 4}`,
].join('\n')
const BY_IP: Record<string, number> = { '10.0.0.1': 0, '10.0.0.2': 1, '10.0.0.3': 2 }

const call = (nodes?: string) =>
  callRoute(GET as any, { params: { id: 'c1' }, searchParams: nodes === undefined ? {} : { nodes } })

beforeEach(() => {
  vi.clearAllMocks()
  clearNodeIpCache()
  ;(checkPermission as any).mockResolvedValue(null)
  ;(getConnectionById as any).mockResolvedValue({ id: 'c1' })
  ;(getExporterPort as any).mockResolvedValue(9926)
  ;(pveFetch as any).mockResolvedValue(STATUS)
  fetchMetrics.mockImplementation(async (ip: string) => osdText(BY_IP[ip]))
})

describe('GET /connections/[id]/ceph/exporter?nodes=', () => {
  it('merges the OSDs of every node and flags each node', async () => {
    const res = await call('pve1,pve2')
    expect(res.status).toBe(200)
    const { data } = await readJson<any>(res)
    expect(data.at).toEqual(expect.any(Number))
    expect(data.nodes).toEqual({ pve1: { ok: true }, pve2: { ok: true } })
    expect(data.osds).toEqual({
      '0': { node: 'pve1', op_r: 1, op_w: 2, op_r_out_bytes: 3, op_w_in_bytes: 4 },
      '1': { node: 'pve2', op_r: 2, op_w: 3, op_r_out_bytes: 4, op_w_in_bytes: 5 },
    })
    expect((pveFetch as any)).toHaveBeenCalledTimes(1)
  })

  it('says why each node is not read: refused, timeout or invalid, never the raw error', async () => {
    fetchMetrics.mockImplementation(async (ip: string) => {
      if (ip === '10.0.0.1') throw new ExporterError('refused')
      if (ip === '10.0.0.2') throw new ExporterError('timeout')
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.3:9926'), { code: 'ECONNREFUSED' }) })
    })
    const res = await call('pve1,pve2,pve3')
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.nodes).toEqual({
      pve1: { ok: false, reason: 'refused' },
      pve2: { ok: false, reason: 'timeout' },
      pve3: { ok: false, reason: 'refused' },
    })
    expect(body.data.osds).toEqual({})
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\./)
  })

  it('a node that is read carries no reason', async () => {
    const { data } = await readJson<any>(await call('pve1'))
    expect(data.nodes.pve1).toEqual({ ok: true })
  })

  it('an unreachable node is ok:false, its OSDs absent, the response still 200 and free of raw errors', async () => {
    fetchMetrics.mockImplementation(async (ip: string) => {
      if (ip === '10.0.0.2') throw new Error('connect ECONNREFUSED 10.0.0.2:9926')
      return osdText(BY_IP[ip])
    })
    const res = await call('pve1,pve2')
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.nodes).toEqual({ pve1: { ok: true }, pve2: { ok: false, reason: 'invalid' } })
    expect(Object.keys(body.data.osds)).toEqual(['0'])
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.2/)
  })

  it('reads at most 4 nodes at a time', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ type: 'node', name: `n${i}`, ip: `10.0.1.${i + 1}` }))
    ;(pveFetch as any).mockResolvedValue(many)
    let running = 0
    let peak = 0
    fetchMetrics.mockImplementation(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise(r => setTimeout(r, 5))
      running--
      return ''
    })
    const res = await call(many.map(n => n.name).join(','))
    expect(res.status).toBe(200)
    expect(fetchMetrics).toHaveBeenCalledTimes(10)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('400 on a missing list, more than 20 nodes or a bad name', async () => {
    expect((await call()).status).toBe(400)
    expect((await call(Array.from({ length: 21 }, (_, i) => `n${i}`).join(','))).status).toBe(400)
    expect((await call('pve1,a b')).status).toBe(400)
    expect(fetchMetrics).not.toHaveBeenCalled()
  })

  it('404 when a listed node is not a member of the connection', async () => {
    expect((await call('pve1,ghost')).status).toBe(404)
    expect(fetchMetrics).not.toHaveBeenCalled()
  })

  it('403 without the view permission, before any read', async () => {
    ;(checkPermission as any).mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await call('pve1')).status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith('connection.view', 'connection', 'c1')
    expect(pveFetch).not.toHaveBeenCalled()
  })

  it('404 for a connection of another tenant, before any address is read or fetched', async () => {
    ;(getConnectionById as any).mockRejectedValue(new Error('Connection not found: c1'))
    const res = await call('pve1')
    expect(res.status).toBe(404)
    expect((pveFetch as any)).not.toHaveBeenCalled()
    expect(fetchMetrics).not.toHaveBeenCalled()
  })
})
