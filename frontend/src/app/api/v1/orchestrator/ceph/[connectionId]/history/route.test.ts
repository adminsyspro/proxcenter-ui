import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// Provider or MSP tenant: the IaaS Ceph gate lets the caller through (its own tests: lib/ceph/tenantGuard*.test.ts).
vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: async () => null }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))
vi.mock('@/lib/tenant', () => ({ getTenantConnectionIds: vi.fn<() => Promise<Set<string>>>() }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ getServerLicense: vi.fn<() => Promise<any>>() }))
const getCephHistory = vi.fn<(...a: any[]) => Promise<any>>()
vi.mock('@/lib/orchestrator/client', () => ({ getOrchestratorClient: () => ({ getCephHistory }) }))

import { GET } from './route'
import { checkPermission } from '@/lib/rbac'
import { getTenantConnectionIds } from '@/lib/tenant'
import { getServerLicense } from '@/lib/auth/requireEnterprise'

const POINT = {
  time: 1793520000, health: 1, read_ops: 10, write_ops: 5, read_bytes: 1000, write_bytes: 500, recovering_bytes: 0,
  degraded_objects: 0, misplaced_objects: 0, pgs_total: 64, pgs_clean: 64, raw_used_bytes: 100, raw_total_bytes: 1000,
  osd_total: 3, osd_up: 3, osd_in: 3, osd_lat_avg_ms: null, osd_lat_max_ms: 4.5,
}
const HISTORY = { from: '2026-11-01T00:00:00Z', to: '2026-11-08T00:00:00Z', step: 1800, points: [POINT], slowest_osds: [{ osd_id: 2, avg_ms: 3, max_ms: 9 }] }
const get = (searchParams: Record<string, string> = { range: '7d' }) =>
  callRoute(GET, { params: { connectionId: 'c1' }, method: 'GET', searchParams })

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkPermission as any).mockResolvedValue(null)
  ;(getTenantConnectionIds as any).mockResolvedValue(new Set(['c1']))
  ;(getServerLicense as any).mockResolvedValue({ enterprise: true })
  getCephHistory.mockResolvedValue({ data: HISTORY, status: 200 })
})

describe('GET /api/v1/orchestrator/ceph/[connectionId]/history', () => {
  it('Community: 404 and the orchestrator is never called', async () => {
    ;(getServerLicense as any).mockResolvedValue({ enterprise: false })
    const res = await get()
    expect(res.status).toBe(404)
    expect(await readJson<any>(res)).toEqual({ error: 'Not found' })
    expect(getCephHistory).not.toHaveBeenCalled()
  })

  it('Enterprise, range=7d: step 1800 over a 7 day window', async () => {
    const res = await get({ range: '7d', top: '5' })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body).toEqual({ data: HISTORY })
    expect(body.data.points[0].osd_lat_avg_ms).toBeNull()
    const [id, opts] = getCephHistory.mock.calls[0]
    expect(id).toBe('c1')
    expect(opts.step).toBe(1800)
    expect(opts.top).toBe(5)
    expect(Date.parse(opts.to) - Date.parse(opts.from)).toBe(7 * 86_400_000)
  })

  it('maps every range to its step', async () => {
    for (const [range, step] of [['1h', 60], ['24h', 300], ['30d', 7200]] as const) {
      await get({ range })
      expect(getCephHistory.mock.calls.at(-1)![1].step).toBe(step)
    }
  })

  it('400 on an unknown range or a bad top', async () => {
    expect((await get({ range: 'foo' })).status).toBe(400)
    expect((await get({ range: '1h', top: '0' })).status).toBe(400)
    expect(getCephHistory).not.toHaveBeenCalled()
  })

  it('forwards osds as distinct integers, in order, and passes osd_series through', async () => {
    const withSeries = { ...HISTORY, osd_series: { '0': [{ time: 1793520000, avg_ms: 1.5, max_ms: 3 }] } }
    getCephHistory.mockResolvedValue({ data: withSeries, status: 200 })
    const res = await get({ range: '1h', osds: '3,0,3,12' })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data.osd_series['0'][0].max_ms).toBe(3)
    expect(getCephHistory.mock.calls[0][1].osds).toEqual([3, 0, 12])
  })

  it('forwards osd_io=1 with osds and passes osd_io_series and exporter through', async () => {
    const body = { ...HISTORY, osd_io_series: { 0: [{ time: 1, read_ops: 2, write_ops: 3, read_bytes: 4, write_bytes: 5 }] }, exporter: { nodes: { pve1: { ok: true, last_ok: 1 } } } }
    getCephHistory.mockResolvedValue({ data: body, status: 200 })
    const res = await get({ range: '1h', osds: '0', osd_io: '1' })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toEqual(body)
    expect(getCephHistory.mock.calls[0][1]).toMatchObject({ osds: [0], osdIo: true })
  })

  it('without osd_io the flag is not sent', async () => {
    await get({ range: '1h', osds: '0' })
    expect(getCephHistory.mock.calls[0][1].osdIo).toBeUndefined()
  })

  it('400 on osd_io without osds or with another value, the orchestrator is never called', async () => {
    expect((await get({ range: '1h', osd_io: '1' })).status).toBe(400)
    expect((await get({ range: '1h', osds: '0', osd_io: 'true' })).status).toBe(400)
    expect(getCephHistory).not.toHaveBeenCalled()
  })

  it('without osds the orchestrator gets none', async () => {
    await get({ range: '1h' })
    expect(getCephHistory.mock.calls[0][1].osds).toBeUndefined()
  })

  it('400 on an invalid osds list, the orchestrator is never called', async () => {
    const hundredOne = Array.from({ length: 101 }, (_, i) => i).join(',')
    for (const osds of ['', 'a', '1,,2', '-1', '1.5', '1,x', ' 1', '0x1', hundredOne]) {
      expect((await get({ range: '1h', osds })).status, osds).toBe(400)
    }
    expect(getCephHistory).not.toHaveBeenCalled()
  })

  it('100 distinct ids pass, duplicates do not count twice', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i).join(',')
    expect((await get({ range: '1h', osds: hundred })).status).toBe(200)
    expect((await get({ range: '1h', osds: `${hundred},5,6` })).status).toBe(200)
    expect(getCephHistory.mock.calls[1][1].osds).toHaveLength(100)
  })

  it('404 when the connection is not in the tenant, 403 when the permission is refused', async () => {
    ;(getTenantConnectionIds as any).mockResolvedValue(new Set(['other']))
    expect((await get()).status).toBe(404)
    ;(checkPermission as any).mockResolvedValueOnce(new Response('{}', { status: 403 }))
    expect((await get()).status).toBe(403)
    expect(getCephHistory).not.toHaveBeenCalled()
  })

  it('503 ORCHESTRATOR_UNAVAILABLE without console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCephHistory.mockRejectedValue(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    const res = await get()
    expect(res.status).toBe(503)
    expect(await readJson<any>(res)).toMatchObject({ code: 'ORCHESTRATOR_UNAVAILABLE' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('an orchestrator without the route (404) is a 404 here, without console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCephHistory.mockRejectedValue(new Error('Orchestrator 404: 404 page not found'))
    const res = await get()
    expect(res.status).toBe(404)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('500: generic message, neither the host nor the address in the response, the log gets them', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCephHistory.mockRejectedValue(new Error('Orchestrator 500: dial tcp 10.42.0.101 on pve1 refused'))
    const res = await get()
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body).toEqual({ error: 'Failed to read the Ceph history' })
    expect(spy.mock.calls.flat().join(' ')).toContain('10.42.0.101')
    spy.mockRestore()
  })

  it('any LICENSE_* 403 from the backend is a 404 too', async () => {
    for (const code of ['LICENSE_REQUIRED', 'LICENSE_EXPIRED', 'LICENSE_FEATURE_MISSING']) {
      getCephHistory.mockRejectedValueOnce(new Error(`Orchestrator 403: {"error":"x","code":"${code}"}`))
      expect((await get()).status, code).toBe(404)
    }
  })
})
