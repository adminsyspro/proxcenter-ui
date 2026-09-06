import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdminMock = vi.fn<() => Promise<any>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()
const refreshRemoteCatalogMock = vi.fn<() => Promise<any>>()
const getEffectiveCatalogMock = vi.fn<() => Promise<any>>()
const auditMock = vi.fn<(...a: any[]) => Promise<string>>()

vi.mock('@/lib/rbac', () => ({ requireAdmin: () => requireAdminMock() }))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: () => getCurrentTenantIdMock(),
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/templates/catalogStore', () => ({
  refreshRemoteCatalog: () => refreshRemoteCatalogMock(),
  getEffectiveCatalog: () => getEffectiveCatalogMock(),
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

import { POST } from './route'

const meta = { source: 'remote', catalogUpdatedAt: '2026-10-01', fetchedAt: 'x', lastCheckedAt: 'y', lastResult: 'updated', lastError: null, url: 'u', autoUpdate: true }

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue(null)
  getCurrentTenantIdMock.mockReset().mockResolvedValue('default')
  refreshRemoteCatalogMock.mockReset().mockResolvedValue({ result: 'updated', added: ['ubuntu-2610'], updated: [], removed: [], error: null })
  getEffectiveCatalogMock.mockReset().mockResolvedValue({ images: [], vendors: [], meta })
  auditMock.mockReset().mockResolvedValue('audit-id')
})

describe('POST /api/v1/templates/catalog/refresh', () => {
  it('refreshes, audits and returns the outcome with the fresh meta', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ result: 'updated', added: ['ubuntu-2610'], updated: [], removed: [], error: null, meta })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update', category: 'templates', resourceType: 'image_catalog', status: 'success',
      details: expect.objectContaining({ result: 'updated', added: 1, updated: 0, removed: 0 }),
    }))
  })

  it('still answers 200 with result error when the fetch failed, and audits a failure', async () => {
    refreshRemoteCatalogMock.mockResolvedValue({ result: 'error', added: [], updated: [], removed: [], error: 'HTTP 503' })
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.result).toBe('error')
    expect(body.data.error).toBe('HTTP 503')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure', errorMessage: 'HTTP 503' }))
  })

  it('returns the admin denial untouched and never refreshes', async () => {
    requireAdminMock.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    const res = await POST()
    expect(res.status).toBe(403)
    expect(refreshRemoteCatalogMock).not.toHaveBeenCalled()
  })

  it('refuses a non-provider tenant with 403 and never refreshes', async () => {
    getCurrentTenantIdMock.mockResolvedValue('acme')
    const res = await POST()
    expect(res.status).toBe(403)
    expect(refreshRemoteCatalogMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('answers 500 when something unexpected throws', async () => {
    getEffectiveCatalogMock.mockRejectedValue(new Error('db down'))
    const res = await POST()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
