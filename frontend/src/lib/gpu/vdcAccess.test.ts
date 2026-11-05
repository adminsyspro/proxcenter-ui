import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  sessionUser: vi.fn(),
  hasServerFeature: vi.fn(),
  getVdcById: vi.fn(),
  getCurrentTenantId: vi.fn(),
  listEntries: vi.fn(),
  findFirst: vi.fn(),
  getConnectionById: vi.fn(),
  getConnectionGpus: vi.fn(),
  buildGpuReport: vi.fn(),
  getGpuMetricsLatest: vi.fn(),
  visibleLatest: vi.fn(),
  poolGpus: vi.fn(),
  entryUsage: vi.fn(),
}))

vi.mock('@/lib/gpu/guard', () => ({ sessionUser: m.sessionUser }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: m.hasServerFeature }))
vi.mock('@/lib/license/features', () => ({ Features: { GPU_MANAGEMENT: 'gpu_management' } }))
vi.mock('@/lib/vdc', () => ({ getVdcById: m.getVdcById }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: m.getCurrentTenantId }))
vi.mock('@/lib/gpu/vdcEntries', () => ({ listVdcGpuEntries: m.listEntries }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findFirst: m.findFirst } } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: m.getConnectionById }))
vi.mock('@/lib/gpu/collect', () => ({ getConnectionGpus: m.getConnectionGpus }))
vi.mock('@/lib/gpu/report', () => ({ buildGpuReport: m.buildGpuReport }))
vi.mock('@/lib/gpu/vdcQuota', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/vdcQuota')>('@/lib/gpu/vdcQuota')
  return { poolGpus: m.poolGpus, entryUsage: m.entryUsage, unresolvedVgpuModelsOf: actual.unresolvedVgpuModelsOf }
})
vi.mock('@/lib/gpu/metrics', () => ({
  gpuCode: (error: string, status: number) => Response.json({ error }, { status }),
  gpuFeatureRequired: () => Response.json({ error: 'feature_required' }, { status: 403 }),
  getGpuMetricsLatest: m.getGpuMetricsLatest,
  visibleLatest: m.visibleLatest,
}))

import { requireVdcGpuAccess } from './vdcAccess'

const vdc = { id: 'v1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'pool1', enabled: true }

async function code(r: Response | null) {
  return r ? { status: r.status, error: (await r.json()).error } : null
}

beforeEach(() => {
  vi.resetAllMocks()
  m.sessionUser.mockResolvedValue({ id: 'u1' })
  m.hasServerFeature.mockResolvedValue(true)
  m.getVdcById.mockResolvedValue({ ...vdc })
  m.getCurrentTenantId.mockResolvedValue('t1')
  m.listEntries.mockResolvedValue([{ id: 'e1' }])
})

describe('requireVdcGpuAccess', () => {
  it('no session: 401', async () => {
    m.sessionUser.mockResolvedValue(null)
    const r = await requireVdcGpuAccess('v1', { write: false })
    expect(await code(r.denied)).toEqual({ status: 401, error: 'not_authenticated' })
  })

  it('no licence: 403', async () => {
    m.hasServerFeature.mockResolvedValue(false)
    const r = await requireVdcGpuAccess('v1', { write: false })
    expect(await code(r.denied)).toEqual({ status: 403, error: 'feature_required' })
  })

  it('tenant resolution failing: 404 whether the vDC exists or not', async () => {
    m.getCurrentTenantId.mockRejectedValue(new Error('tenant access'))
    for (const found of [true, false]) {
      m.getVdcById.mockResolvedValue(found ? { ...vdc } : null)
      const r = await requireVdcGpuAccess('v1', { write: false })
      expect(await code(r.denied)).toEqual({ status: 404, error: 'not_found' })
    }
  })

  it('unknown vDC: 404', async () => {
    m.getVdcById.mockResolvedValue(null)
    const r = await requireVdcGpuAccess('v1', { write: false })
    expect(await code(r.denied)).toEqual({ status: 404, error: 'not_found' })
  })

  it('vDC of another tenant: 404', async () => {
    m.getCurrentTenantId.mockResolvedValue('t2')
    const r = await requireVdcGpuAccess('v1', { write: false })
    expect(await code(r.denied)).toEqual({ status: 404, error: 'not_found' })
  })

  it('disabled vDC: 404', async () => {
    m.getVdcById.mockResolvedValue({ ...vdc, enabled: false })
    const r = await requireVdcGpuAccess('v1', { write: false })
    expect(await code(r.denied)).toEqual({ status: 404, error: 'not_found' })
  })

  it('no contingent line: 404', async () => {
    m.listEntries.mockResolvedValue([])
    const r = await requireVdcGpuAccess('v1', { write: false })
    expect(await code(r.denied)).toEqual({ status: 404, error: 'not_found' })
  })

  it('provider reading: allowed', async () => {
    m.getCurrentTenantId.mockResolvedValue('default')
    const r = await requireVdcGpuAccess('v1', { write: false })
    expect(r).toMatchObject({ denied: null, isProvider: true, userId: 'u1', vdc: { id: 'v1', pvePoolName: 'pool1' } })
  })

  it('provider writing: 404', async () => {
    m.getCurrentTenantId.mockResolvedValue('default')
    const r = await requireVdcGpuAccess('v1', { write: true })
    expect(await code(r.denied)).toEqual({ status: 404, error: 'not_found' })
  })

  it('owner tenant: allowed, read and write', async () => {
    for (const write of [false, true]) {
      const r = await requireVdcGpuAccess('v1', { write })
      expect(r).toMatchObject({ denied: null, isProvider: false, userId: 'u1' })
    }
  })
})
