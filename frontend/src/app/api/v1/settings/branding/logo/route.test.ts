import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireBrandingAdmin: vi.fn(async () => null as any),
  getCurrentTenantId: vi.fn(async () => 'default'),
  putAsset: vi.fn(async () => {}),
  deleteAsset: vi.fn(async () => {}),
  syncEmailLogo: vi.fn(async () => true),
}))

vi.mock('@/lib/branding/guard', () => ({ requireBrandingAdmin: h.requireBrandingAdmin }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId }))
vi.mock('@/lib/branding/assetStore', () => ({ putAsset: h.putAsset, deleteAsset: h.deleteAsset }))
vi.mock('@/lib/branding/emailLogo', () => ({ LOGO_SLOT: 'logo', EMAIL_LOGO_SLOT: 'logo-email', syncEmailLogo: h.syncEmailLogo }))

import { POST, DELETE } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

beforeEach(() => {
  h.requireBrandingAdmin.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue('default')
  h.putAsset.mockReset().mockResolvedValue(undefined)
  h.deleteAsset.mockReset().mockResolvedValue(undefined)
  h.syncEmailLogo.mockReset().mockResolvedValue(true)
})

function formWith(file: File, type: string) {
  const fd = new FormData()
  fd.set('file', file)
  fd.set('type', type)
  return fd
}

describe('POST /settings/branding/logo', () => {
  it('403 when denied', async () => {
    h.requireBrandingAdmin.mockResolvedValue(new Response('no', { status: 403 }) as any)
    const res = await callRoute(POST, { body: formWith(new File(['x'], 'logo.png', { type: 'image/png' }), 'logo') })
    expect(res.status).toBe(403)
  })

  it('stores the asset and returns an imageUrl with the extension', async () => {
    const res = await callRoute(POST, { body: formWith(new File(['abc'], 'logo.png', { type: 'image/png' }), 'logo') })
    const body = await readJson<any>(res)
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.imageUrl).toMatch(/^\/api\/v1\/settings\/branding\/uploads\/logo\.png\?t=\d+&tenant=default&scope=default$/)
    expect(h.putAsset).toHaveBeenCalledWith('default', 'branding', 'logo', 'png', 'image/png', expect.any(Buffer))
  })

  it('renders the email copy when the logo changes', async () => {
    await callRoute(POST, { body: formWith(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), 'logo') })
    expect(h.syncEmailLogo).toHaveBeenCalledWith('default', expect.any(Buffer))
  })

  it('leaves the email copy alone for the favicon and the login logo', async () => {
    await callRoute(POST, { body: formWith(new File(['x'], 'favicon.png', { type: 'image/png' }), 'favicon') })
    await callRoute(POST, { body: formWith(new File(['x'], 'login.png', { type: 'image/png' }), 'loginLogo') })
    expect(h.syncEmailLogo).not.toHaveBeenCalled()
  })

  it('keeps the upload when the email copy fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.syncEmailLogo.mockRejectedValue(new Error('db down'))
    const res = await callRoute(POST, { body: formWith(new File(['abc'], 'logo.png', { type: 'image/png' }), 'logo') })
    expect(res.status).toBe(200)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('rejects an invalid type', async () => {
    const res = await callRoute(POST, { body: formWith(new File(['x'], 'x.png', { type: 'image/png' }), 'banner') })
    expect(res.status).toBe(400)
    expect(h.putAsset).not.toHaveBeenCalled()
  })

  it('rejects a disallowed mime', async () => {
    const res = await callRoute(POST, { body: formWith(new File(['x'], 'x.txt', { type: 'text/plain' }), 'logo') })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /settings/branding/logo', () => {
  it('deletes the asset for the type', async () => {
    const res = await callRoute(DELETE, { method: 'DELETE', body: { type: 'favicon' } })
    expect(res.status).toBe(200)
    expect(h.deleteAsset).toHaveBeenCalledWith('default', 'branding', 'favicon')
    expect(h.deleteAsset).toHaveBeenCalledTimes(1)
  })

  it('removes the email copy with the logo', async () => {
    await callRoute(DELETE, { method: 'DELETE', body: { type: 'logo' } })
    expect(h.deleteAsset).toHaveBeenCalledWith('default', 'branding', 'logo')
    expect(h.deleteAsset).toHaveBeenCalledWith('default', 'branding', 'logo-email')
  })
})
