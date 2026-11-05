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

import { loadVdcGpuContext } from './vdcContext'

const vdc = { id: 'v1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'pool1', enabled: true }

beforeEach(() => {
  vi.resetAllMocks()
  m.sessionUser.mockResolvedValue({ id: 'u1' })
  m.hasServerFeature.mockResolvedValue(true)
  m.getVdcById.mockResolvedValue({ ...vdc })
  m.getCurrentTenantId.mockResolvedValue('t1')
  m.listEntries.mockResolvedValue([{ id: 'e1' }])
})

describe('loadVdcGpuContext', () => {
  const snap = { connId: 'c1', nodes: [], devices: [], allocations: [] }
  const report = { devices: [], allocations: [], nodes: [] }

  beforeEach(() => {
    m.findFirst.mockResolvedValue({ id: 'c1', tenantId: 'default', name: 'PVE' })
    m.getConnectionById.mockResolvedValue({ host: 'h' })
    m.getConnectionGpus.mockResolvedValue(snap)
    m.buildGpuReport.mockReturnValue(report)
    m.poolGpus.mockReturnValue([])
    m.entryUsage.mockReturnValue(new Map())
    m.listEntries.mockResolvedValue([{ id: 'e1' }])
  })

  it('builds an infrastructure-scope report on the vDC connection only', async () => {
    m.getGpuMetricsLatest.mockResolvedValue({ at: 'x' })
    m.visibleLatest.mockReturnValue({ at: 'x', gpus: [], probes: [], vgpus: [], vgpuTypes: [{ typeId: 't' }] })
    const ctx = await loadVdcGpuContext(vdc, { refresh: true })
    expect(m.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', type: 'pve' }, select: { id: true, tenantId: true, name: true } })
    expect(m.getConnectionById).toHaveBeenCalledWith('c1', 'default')
    expect(m.getConnectionGpus).toHaveBeenCalledWith({ host: 'h' }, { id: 'c1', name: 'PVE' }, { refresh: true })
    expect(m.buildGpuReport).toHaveBeenCalledWith([snap], { tenantPools: null, visibleNodes: null, visibleVms: null })
    expect(m.poolGpus).toHaveBeenCalledWith(report, 'pool1', [{ typeId: 't' }])
    expect(ctx.catalog).toEqual([{ typeId: 't' }])
    expect(ctx.latest).not.toBeNull()
    expect(ctx.report).toBe(report)
    expect(ctx.snapshot).toBe(snap)
  })

  it('orchestrator error: empty catalog, no latest, no throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.getGpuMetricsLatest.mockRejectedValue(new Error('down'))
    const ctx = await loadVdcGpuContext(vdc, { refresh: false })
    expect(ctx.catalog).toEqual([])
    expect(ctx.latest).toBeNull()
    expect(m.poolGpus).toHaveBeenCalledWith(report, 'pool1', [])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('names the models of the pool vGPUs whose profile the catalog misses', async () => {
    m.getGpuMetricsLatest.mockRejectedValue(new Error('down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.poolGpus.mockReturnValue([
      { vmid: '1', kind: 'vgpu', modelKey: '0x10de:0x2231', profileName: null, template: false },
      { vmid: '2', kind: 'vgpu', modelKey: '0x10de:0x2236', profileName: 'A10-12Q', template: false },
    ])
    const ctx = await loadVdcGpuContext(vdc, { refresh: false })
    expect(ctx.unresolvedVgpuModels).toEqual(new Set(['0x10de:0x2231']))
  })
})

