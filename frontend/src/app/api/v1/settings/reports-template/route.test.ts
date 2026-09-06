import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  getCurrentTenantId: vi.fn(async () => 'default'),
  getSetting: vi.fn(async () => null as any),
  setSetting: vi.fn(async () => undefined),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: h.checkPermission, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId, DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/db/settings', () => ({ getSetting: h.getSetting, setSetting: h.setSetting }))

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { DEFAULT_REPORT_TEMPLATE } from '@/lib/reports/templateSettings'
import { GET, PUT } from './route'

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue('default')
  h.getSetting.mockReset().mockResolvedValue(null)
  h.setSetting.mockReset().mockResolvedValue(undefined)
})

describe('GET /settings/reports-template', () => {
  it('returns a permission denial without reading settings', async () => {
    h.checkPermission.mockResolvedValue(new Response('no', { status: 403 }) as any)

    const res = await callRoute(GET)

    expect(res.status).toBe(403)
    expect(h.getSetting).not.toHaveBeenCalled()
  })

  it('returns exactly the defaults when no setting is stored', async () => {
    const res = await callRoute(GET)

    expect(await readJson(res)).toEqual(DEFAULT_REPORT_TEMPLATE)
  })

  it('merges a partial stored row over defaults for the current tenant', async () => {
    h.getCurrentTenantId.mockResolvedValue('acme')
    h.getSetting.mockResolvedValue({ footerText: 'Internal', pageSize: 'Letter' })

    const res = await callRoute(GET)

    expect(await readJson(res)).toEqual({
      ...DEFAULT_REPORT_TEMPLATE,
      footerText: 'Internal',
      pageSize: 'Letter',
    })
    expect(h.getSetting).toHaveBeenCalledWith('reports_template', 'acme')
  })

  it('returns stored CSS that is refused by the current validator unchanged', async () => {
    const customCss = '@import url(http://x)'
    h.getSetting.mockResolvedValue({ customCss })

    const body = await readJson<any>(await callRoute(GET))

    expect(body.customCss).toBe(customCss)
  })
})

describe('PUT /settings/reports-template', () => {
  it('returns a permission denial', async () => {
    h.checkPermission.mockResolvedValue(new Response('no', { status: 403 }) as any)

    const res = await callRoute(PUT, { method: 'PUT', body: {} })

    expect(res.status).toBe(403)
    expect(h.setSetting).not.toHaveBeenCalled()
  })

  it('refuses remote CSS without storing it', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: { customCss: 'url(http://x)' } })
    const body = await readJson<any>(res)

    expect(res.status).toBe(400)
    expect(body).toEqual({
      error: 'url() in custom CSS may only reference data: URIs',
      code: 'remoteUrl',
    })
    expect(h.setSetting).not.toHaveBeenCalled()
  })

  it('rejects a non-object body', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: 'not json' })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'Invalid request body' })
  })

  it('stores and returns the normalized value', async () => {
    const res = await callRoute(PUT, {
      method: 'PUT',
      body: { pageSize: 'A3', primaryColor: '003366', coverSubtitle: '  Quarterly report  ' },
    })
    const body = await readJson<any>(res)
    const normalized = {
      ...DEFAULT_REPORT_TEMPLATE,
      pageSize: 'A4',
      primaryColor: '#003366',
      coverSubtitle: 'Quarterly report',
    }

    expect(h.setSetting).toHaveBeenCalledWith('reports_template', 'default', normalized)
    expect(body).toEqual({ success: true, ...normalized })
  })

  it('stores settings under the current tenant', async () => {
    h.getCurrentTenantId.mockResolvedValue('acme')

    const res = await callRoute(PUT, { method: 'PUT', body: {} })

    expect(res.status).toBe(200)
    expect(h.setSetting).toHaveBeenCalledWith('reports_template', 'acme', DEFAULT_REPORT_TEMPLATE)
  })
})
