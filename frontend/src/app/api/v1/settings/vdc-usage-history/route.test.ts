/**
 * /api/v1/settings/vdc-usage-history (#902): provider settings of the vDC
 * usage history, with the sampler status.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { providerMock, permMock, loadMock, saveMock, auditMock, prismaMock } = vi.hoisted(() => ({
  providerMock: vi.fn(),
  permMock: vi.fn(),
  loadMock: vi.fn(),
  saveMock: vi.fn(),
  auditMock: vi.fn(),
  prismaMock: {
    vdcUsageSample: { count: vi.fn(), findFirst: vi.fn() },
    schedulerLease: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: () => providerMock() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: () => permMock(), PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))
vi.mock('@/lib/vdc/usageHistory/settings', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/vdc/usageHistory/settings')>()),
  loadVdcUsageHistorySettings: () => loadMock(),
  saveVdcUsageHistorySettings: (...a: any[]) => saveMock(...a),
}))

import { DEFAULT_VDC_USAGE_HISTORY_SETTINGS } from '@/lib/vdc/usageHistory/settings'

import { GET, PUT } from './route'

beforeEach(() => {
  providerMock.mockReset().mockResolvedValue(null)
  permMock.mockReset().mockResolvedValue(null)
  loadMock.mockReset().mockResolvedValue({ ...DEFAULT_VDC_USAGE_HISTORY_SETTINGS })
  saveMock.mockReset().mockImplementation(async (v: any) => v)
  auditMock.mockReset().mockResolvedValue('a1')
  prismaMock.vdcUsageSample.count.mockReset().mockResolvedValue(42)
  prismaMock.vdcUsageSample.findFirst.mockReset().mockResolvedValue({ sampledAt: new Date('2026-10-14T10:00:00Z') })
  prismaMock.schedulerLease.findUnique.mockReset().mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000) })
})

describe('GET /api/v1/settings/vdc-usage-history', () => {
  it('returns the settings and what the sampler last did', async () => {
    const res = await callRoute(GET, { method: 'GET' })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: DEFAULT_VDC_USAGE_HISTORY_SETTINGS,
      status: { samples: 42, lastSampledAt: '2026-10-14T10:00:00.000Z', samplerActive: true },
    })
  })

  it('reports an idle sampler when the lease expired or never existed', async () => {
    prismaMock.schedulerLease.findUnique.mockResolvedValueOnce({ expiresAt: new Date(Date.now() - 1000) })
    expect((await readJson<any>(await callRoute(GET, { method: 'GET' }))).status.samplerActive).toBe(false)

    prismaMock.schedulerLease.findUnique.mockResolvedValueOnce(null)
    prismaMock.vdcUsageSample.findFirst.mockResolvedValueOnce(null)
    const body = await readJson<any>(await callRoute(GET, { method: 'GET' }))

    expect(body.status).toEqual({ samples: 42, lastSampledAt: null, samplerActive: false })
  })

  it('is refused outside the provider tenant and without the permission', async () => {
    providerMock.mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await callRoute(GET, { method: 'GET' })).status).toBe(403)

    permMock.mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await callRoute(GET, { method: 'GET' })).status).toBe(403)
  })

  it('answers 500 when the settings cannot be read', async () => {
    loadMock.mockRejectedValueOnce(new Error('db down'))
    expect((await callRoute(GET, { method: 'GET' })).status).toBe(500)
  })
})

describe('PUT /api/v1/settings/vdc-usage-history', () => {
  it('saves valid settings and audits the change', async () => {
    const body = { enabled: true, intervalMinutes: 1, retentionDays: 30 }
    const res = await callRoute(PUT, { method: 'PUT', body })

    expect(res.status).toBe(200)
    expect(saveMock).toHaveBeenCalledWith(body)
    expect((await readJson<any>(res)).data).toEqual(body)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'vdc_usage_history_settings',
      details: { before: DEFAULT_VDC_USAGE_HISTORY_SETTINGS, after: body },
    }))
  })

  it('rejects an out of range cadence or retention', async () => {
    for (const body of [{ intervalMinutes: 0 }, { intervalMinutes: 1441 }, { retentionDays: 0 }, { retentionDays: 1.5 }]) {
      const res = await callRoute(PUT, { method: 'PUT', body })

      expect(res.status).toBe(400)
    }
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON', async () => {
    const res = await PUT(new Request('http://x', { method: 'PUT', body: 'nope' }))

    expect(res.status).toBe(400)
  })

  it('is refused outside the provider tenant', async () => {
    providerMock.mockResolvedValueOnce(new Response('no', { status: 403 }))
    expect((await callRoute(PUT, { method: 'PUT', body: {} })).status).toBe(403)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('answers 500 when the save fails', async () => {
    saveMock.mockRejectedValueOnce(new Error('db down'))
    expect((await callRoute(PUT, { method: 'PUT', body: {} })).status).toBe(500)
  })
})
