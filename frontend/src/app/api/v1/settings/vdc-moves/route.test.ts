import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ providerGate: vi.fn(), checkPermission: vi.fn(), getSetting: vi.fn(), setSetting: vi.fn(), audit: vi.fn() }))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: h.providerGate }))
vi.mock('@/lib/rbac', () => ({ checkPermission: h.checkPermission, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/db/settings', () => ({ getSetting: h.getSetting, setSetting: h.setSetting }))
vi.mock('@/lib/audit', () => ({ audit: h.audit }))
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_s: any, handler: any) => handler }))

import { GET, PUT } from './route'
import { bwlimitKiBps, parseVdcMoveSettings } from '@/lib/vdc/move/settings'

beforeEach(() => {
  vi.clearAllMocks()
  h.providerGate.mockResolvedValue(null)
  h.checkPermission.mockResolvedValue(null)
  h.getSetting.mockResolvedValue(null)
  h.setSetting.mockResolvedValue(undefined)
})

const put = (body: unknown) => new Request('http://x', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('vDC move settings', () => {
  it('answers the defaults when nothing is stored', async () => {
    const res = await GET()
    expect(await res.json()).toEqual({ data: { tenantSelfService: true, maxConcurrentPerTenant: 1, bwlimitMiBps: 0 } })
  })

  it('saves valid settings under the provider tenant and audits the change', async () => {
    const res = await PUT(put({ tenantSelfService: false, maxConcurrentPerTenant: 3, bwlimitMiBps: 200 }))
    expect(res.status).toBe(200)
    expect(h.setSetting).toHaveBeenCalledWith('vdc.moves', 'default', { tenantSelfService: false, maxConcurrentPerTenant: 3, bwlimitMiBps: 200 })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'vdc_move_settings' }))
  })

  it('refuses out-of-range values and a broken body', async () => {
    expect((await PUT(put({ maxConcurrentPerTenant: 0 }))).status).toBe(400)
    expect((await PUT(put({ bwlimitMiBps: -1 }))).status).toBe(400)
    expect((await PUT(put('{'))).status).toBe(400)
    expect(h.setSetting).not.toHaveBeenCalled()
  })

  it('is provider-only and needs admin.settings', async () => {
    h.providerGate.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await GET()).status).toBe(403)
    h.providerGate.mockResolvedValue(null)
    h.checkPermission.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await PUT(put({}))).status).toBe(403)
  })

  it('reads a corrupt row as the defaults and converts the bandwidth for PVE', () => {
    expect(parseVdcMoveSettings({ maxConcurrentPerTenant: 'x' })).toEqual({ tenantSelfService: true, maxConcurrentPerTenant: 1, bwlimitMiBps: 0 })
    expect(bwlimitKiBps({ tenantSelfService: true, maxConcurrentPerTenant: 1, bwlimitMiBps: 0 })).toBeUndefined()
    expect(bwlimitKiBps({ tenantSelfService: true, maxConcurrentPerTenant: 1, bwlimitMiBps: 50 })).toBe(51200)
  })
})
