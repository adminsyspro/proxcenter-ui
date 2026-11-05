import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  sessionUser: vi.fn(),
  feature: vi.fn(),
  getVdc: vi.fn(),
  tenant: vi.fn(),
  listEntries: vi.fn(),
  load: vi.fn(),
  find: vi.fn(),
  latest: vi.fn(),
}))

vi.mock('@/lib/gpu/guard', () => ({ sessionUser: () => m.sessionUser() }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (...a: unknown[]) => m.feature(...a) }))
vi.mock('@/lib/vdc', () => ({ getVdcById: (...a: unknown[]) => m.getVdc(...a) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('@/lib/gpu/vdcEntries', () => ({ listVdcGpuEntries: (...a: unknown[]) => m.listEntries(...a) }))
vi.mock('@/lib/gpu/vdcContext', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/vdcContext')>('@/lib/gpu/vdcContext')
  return { ...actual, loadVdcGpuContext: (...a: unknown[]) => m.load(...a) }
})
vi.mock('@/lib/gpu/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/metrics')>('@/lib/gpu/metrics')
  return { ...actual, getGpuMetricsLatest: () => m.latest() }
})
vi.mock('@/lib/db/prisma', () => ({ prisma: { gpuUsageHour: { findMany: (...a: unknown[]) => m.find(...a) } } }))

import { GET } from './route'

const vdc = { id: 'vdc-1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'vdc-acme', enabled: true, name: 'Acme' }
const params = { id: 'vdc-1' }
const body = (r: { json: () => Promise<unknown> }) => r.json() as Promise<any>
const at = (month?: string) => ({ params, searchParams: month ? { month } : undefined, url: 'http://test.local/_' })

const usage = {
  vmid: 101, vmName: 'web', deviceKey: 'c1:pve-secret-node:0000:03:00', modelName: 'RTX A5000', mdev: 'nvidia-665', runningSeconds: 7200, reservedSeconds: 3600,
}
const snapshot = (types: unknown[]) => ({ at: '2026-11-02T10:00:00Z', gpus: [], probes: [], vgpus: [], vgpu_types: types })
const type = (connection_id: string, name: string) => ({
  connection_id, node: 'pve-secret-node', bus_id: '0000:03:00', type_id: 665, name, class: 'Quadro', fb_memory: 12288, max_instances: 2,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.sessionUser.mockResolvedValue({ id: 'u1' })
  m.feature.mockResolvedValue(true)
  m.tenant.mockResolvedValue('t1')
  m.getVdc.mockResolvedValue(vdc)
  m.listEntries.mockResolvedValue([{ id: 'e1' }])
  m.find.mockResolvedValue([usage])
  m.latest.mockResolvedValue(snapshot([type('c1', 'RTXA5000-12Q')]))
})

describe('GET /api/v1/vdcs/{id}/gpu/hours', () => {
  it('returns the denial of the access gate untouched and reads nothing', async () => {
    m.tenant.mockResolvedValue('t2')
    const res = await callRoute(GET, at('2026-11'))
    expect(res.status).toBe(404)
    expect(m.find).not.toHaveBeenCalled()
  })

  it('refuses a malformed month with invalid_body', async () => {
    const res = await callRoute(GET, at('2026-13'))
    expect(res.status).toBe(400)
    expect(await body(res)).toEqual({ error: 'invalid_body' })
    expect(m.find).not.toHaveBeenCalled()
  })

  it('reads the rows of the vDC for the month asked', async () => {
    const res = await callRoute(GET, at('2026-10'))
    expect(res.status).toBe(200)
    expect(m.find).toHaveBeenCalledWith(expect.objectContaining({
      where: { vdcId: 'vdc-1', hour: { gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-11-01T00:00:00Z') } },
      orderBy: { hour: 'asc' },
    }))
    expect((await body(res)).data).toEqual({
      month: '2026-10',
      totals: { runningHours: 2, reservedHours: 1 },
      byVm: [{ vmid: '101', vmName: 'web', label: 'RTXA5000-12Q', runningHours: 2, reservedHours: 1 }],
      byProfile: [{ label: 'RTXA5000-12Q', runningHours: 2, reservedHours: 1 }],
    })
  })

  it('defaults to the current month', async () => {
    const res = await callRoute(GET, at())
    expect(res.status).toBe(200)
    const month = new Date().toISOString().slice(0, 7)
    expect((await body(res)).data.month).toBe(month)
    const where = m.find.mock.calls[0][0].where
    expect(where.vdcId).toBe('vdc-1')
    expect(where.hour.gte.toISOString().slice(0, 7)).toBe(month)
  })

  it('makes no PVE call and never exposes the node or the device key', async () => {
    const res = await callRoute(GET, at('2026-11'))
    expect(m.load).not.toHaveBeenCalled()
    const text = JSON.stringify(await body(res))
    expect(text).not.toContain('pve-secret-node')
    expect(text).not.toContain('deviceKey')
    expect(text).not.toMatch(/cost|price|currency/)
  })

  it('ignores the profiles of another connection', async () => {
    m.latest.mockResolvedValue(snapshot([type('c2', 'OTHER-1Q')]))
    const res = await callRoute(GET, at('2026-11'))
    expect((await body(res)).data.byVm[0].label).toBe('vGPU RTX A5000')
  })

  it('still answers when the orchestrator is down, with the generic label', async () => {
    m.latest.mockRejectedValue(new Error('orchestrator 10.0.0.9 down'))
    const res = await callRoute(GET, at('2026-11'))
    expect(res.status).toBe(200)
    expect((await body(res)).data.byVm[0].label).toBe('vGPU RTX A5000')
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('answers 503 unavailable when the database fails, without its text', async () => {
    m.find.mockRejectedValue(new Error('connection refused db-host'))
    const res = await callRoute(GET, at('2026-11'))
    expect(res.status).toBe(503)
    const out = await body(res)
    expect(out).toEqual({ error: 'unavailable' })
    expect(JSON.stringify(out)).not.toContain('db-host')
  })
})
