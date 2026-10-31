import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import type { ClusterCapacity, NodeCapacity, StoragePoolCapacity, Thresholds } from '@/lib/resources/capacity'

const { requireFeatureMock, checkPermissionMock, cookieMock, overviewMock, renderPdfMock } = vi.hoisted(() => ({
  requireFeatureMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  cookieMock: vi.fn(),
  overviewMock: vi.fn(),
  renderPdfMock: vi.fn(),
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({ requireFeature: (...a: unknown[]) => requireFeatureMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => cookieMock(name) }) }))
vi.mock('@/lib/tenant', () => ({ getSessionPrisma: async () => ({}), getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/resources/overviewBuilder', () => ({ getResourcesOverview: (...a: unknown[]) => overviewMock(...a) }))
vi.mock('@/lib/reporting/reportBranding', () => ({
  resolveReportBranding: async () => ({ brandColor: '#123456', logoDataUri: 'data:image/png;base64,AAAA', appName: 'ProxCenter' }),
}))
vi.mock('@/lib/reporting/weasyprintClient', () => ({ renderPdf: (...a: unknown[]) => renderPdfMock(...a) }))

import { GET } from './route'

const GiB = 1024 ** 3
const thresholds: Thresholds = { cpu: { warning: 80, critical: 90 }, ram: { warning: 80, critical: 90 }, storage: { warning: 80, critical: 90 } }
const trends = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10)

  return { t: d, d, cpu: 20, ram: 60 + i, storage: 50 }
})

const cluster: ClusterCapacity = {
  id: 'prod', name: 'Datacenter Île-de-France <b>', nodesOnline: 2, nodesTotal: 3,
  cpu: { cores: 32, usedPct: 85, vcpuAllocated: 64, ratio: 2 },
  ram: { total: 128 * GiB, used: 120 * GiB, usedPct: 93, allocated: 140 * GiB, ratio: 1.1 },
  storage: { used: 1, total: 2, pct: 50 },
  guests: { running: 10, stopped: 2, templates: 0 },
  nPlusOne: { applicable: true, largestNode: 'pve1', cpuPctAfter: 95, ramPctAfter: 120, ok: false },
  imbalance: { cpu: 5, ram: 10 },
  trends,
}
const nodes: NodeCapacity[] = [
  { key: 'prod:pve1', connectionId: 'prod', connectionName: 'PVE-PROD', node: 'pve1', online: true, cores: 16, cpuPct: 50, memTotal: 64 * GiB, memUsed: 60 * GiB, ramPct: 94, vcpuAllocated: 32, ramAllocated: 70 * GiB, guestsRunning: 5, guestsTotal: 6 },
  { key: 'prod:pve3', connectionId: 'prod', connectionName: 'PVE-PROD', node: 'pve3', online: false, cores: 0, cpuPct: 0, memTotal: 0, memUsed: 0, ramPct: 0, vcpuAllocated: 0, ramAllocated: 0, guestsRunning: 0, guestsTotal: 0 },
]
const pools: StoragePoolCapacity[] = [
  { key: 'prod::ceph', name: 'ceph', type: 'rbd', shared: true, connectionId: 'prod', connectionName: 'PVE-PROD', node: null, used: 900 * GiB, total: 1000 * GiB, pct: 90, growthPctPerDay: 0.2, daysToThreshold: 0 },
  { key: 'prod:pve1:local', name: 'local', type: 'dir', shared: false, connectionId: 'prod', connectionName: 'PVE-PROD', node: 'pve1', used: 0, total: 100 * GiB, pct: 0, growthPctPerDay: null, daysToThreshold: null },
]
const data = {
  kpis: {
    cpu: { used: 85, allocated: 64, total: 32, trend: 0 },
    ram: { used: 93, allocated: 140, total: 128, trend: 0 },
    storage: { used: 900, total: 1000, trend: 0 },
    vms: { total: 12, running: 10, stopped: 2 },
    efficiency: 40,
  },
  thresholds,
  trends,
  clusters: [cluster],
  nodes,
  storagePools: pools,
  connections: [{ id: 'prod', name: 'Datacenter Île-de-France <b>' }],
  stoppedAllocation: { count: 2, vcpu: 4, ramBytes: 16 * GiB, diskBytes: 100 * GiB },
}

const get = (query = '') => new Request(`http://test.local/api/v1/resources/report${query}`)
const html = () => renderPdfMock.mock.calls[0][0] as string

beforeEach(() => {
  requireFeatureMock.mockReset().mockResolvedValue(null)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  cookieMock.mockReset().mockReturnValue({ value: 'fr' })
  overviewMock.mockReset().mockResolvedValue({ data })
  renderPdfMock.mockReset().mockResolvedValue({ ok: true, pdf: Buffer.from('%PDF-1.7') })
})

describe('GET /api/v1/resources/report', () => {
  it('renders the scope in the UI language and sends the PDF under an ASCII file name', async () => {
    const response = await GET(get('?connectionId=prod'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="capacity-Datacenterle-de-France-b-\d{4}-\d{2}-\d{2}\.pdf"$/)
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('%PDF-1.7')

    expect(overviewMock.mock.calls[0][0]).toMatchObject({ tenantId: 'tenant-1', filterConnectionId: 'prod' })
    // Names from Proxmox are escaped, the report is in French.
    expect(html()).toContain('Datacenter Île-de-France &lt;b&gt;')
    expect(html()).not.toContain('<b></strong>')
    expect(html()).toContain('ProxCenter')
    expect(html()).toContain('pve3')
  })

  it('falls back to English for an unknown UI language and names the whole estate', async () => {
    cookieMock.mockReturnValue({ value: 'xx' })
    await GET(get())

    expect(overviewMock.mock.calls[0][0].filterConnectionId).toBeUndefined()
    expect(html()).toContain('All clusters')
  })

  it('answers 404 for a connection that is not one of the tenant', async () => {
    expect((await GET(get('?connectionId=other'))).status).toBe(404)
    expect(renderPdfMock).not.toHaveBeenCalled()
  })

  it('answers 503 when the PDF service fails', async () => {
    renderPdfMock.mockResolvedValue({ ok: false, error: 'sidecar down' })
    const response = await GET(get())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'sidecar down' })
  })

  it('stops at the feature gate and the permission, and hides internal errors', async () => {
    requireFeatureMock.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }))
    expect((await GET(get())).status).toBe(403)

    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }))
    expect((await GET(get())).status).toBe(403)

    overviewMock.mockRejectedValueOnce(new Error('db detail'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await GET(get())
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
