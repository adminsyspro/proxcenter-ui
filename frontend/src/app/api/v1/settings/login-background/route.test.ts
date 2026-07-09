import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  getCurrentTenantId: vi.fn(async () => 'default'),
  getAsset: vi.fn(async () => null as any),
  putAsset: vi.fn(async () => {}),
  deleteAsset: vi.fn(async () => {}),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: h.checkPermission, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId }))
vi.mock('@/lib/branding/assetStore', () => ({ getAsset: h.getAsset, putAsset: h.putAsset, deleteAsset: h.deleteAsset }))

import { GET, POST, DELETE } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue('default')
  h.getAsset.mockReset().mockResolvedValue(null)
  h.putAsset.mockReset().mockResolvedValue(undefined)
  h.deleteAsset.mockReset().mockResolvedValue(undefined)
})

function formWith(file: File) { const fd = new FormData(); fd.set('file', file); return fd }

describe('login-background route', () => {
  it('GET returns null imageUrl when no asset', async () => {
    const res = await callRoute(GET, { method: 'GET' })
    expect((await readJson<any>(res)).imageUrl).toBeNull()
  })

  it('GET returns an imageUrl when an asset exists', async () => {
    h.getAsset.mockResolvedValue({ ext: 'jpg', contentType: 'image/jpeg', data: Buffer.from([1]) })
    const res = await callRoute(GET, { method: 'GET' })
    expect((await readJson<any>(res)).imageUrl).toMatch(/^\/api\/v1\/settings\/login-background\/serve\/background\.jpg\?t=\d+$/)
  })

  it('POST 403 when denied', async () => {
    h.checkPermission.mockResolvedValue(new Response('no', { status: 403 }) as any)
    const res = await callRoute(POST, { body: formWith(new File(['x'], 'bg.jpg', { type: 'image/jpeg' })) })
    expect(res.status).toBe(403)
  })

  it('POST stores background with normalized jpg extension', async () => {
    const res = await callRoute(POST, { body: formWith(new File(['abc'], 'bg.jpg', { type: 'image/jpeg' })) })
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)
    expect(body.imageUrl).toMatch(/background\.jpg\?t=\d+$/)
    expect(h.putAsset).toHaveBeenCalledWith('default', 'login-bg', 'background', 'jpg', 'image/jpeg', expect.any(Buffer))
  })

  it('POST rejects invalid mime', async () => {
    const res = await callRoute(POST, { body: formWith(new File(['x'], 'x.txt', { type: 'text/plain' })) })
    expect(res.status).toBe(400)
  })

  it('DELETE removes the background', async () => {
    const res = await callRoute(DELETE, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(h.deleteAsset).toHaveBeenCalledWith('default', 'login-bg', 'background')
  })
})
