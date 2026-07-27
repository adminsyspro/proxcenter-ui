import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getCurrentTenantId: vi.fn(async () => 'default'),
  getAsset: vi.fn(async () => null as any),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => Buffer.from([])),
}))

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId }))
vi.mock('@/lib/branding/assetStore', async (orig) => {
  const actual = await orig<typeof import('@/lib/branding/assetStore')>()
  return { ...actual, getAsset: h.getAsset }
})
vi.mock('fs', () => ({ default: { existsSync: h.existsSync, readFileSync: h.readFileSync }, existsSync: h.existsSync, readFileSync: h.readFileSync }))

import { GET } from './route'
import { callRoute } from '@/__tests__/setup/route-test'

beforeEach(() => {
  h.getCurrentTenantId.mockReset().mockResolvedValue('default')
  h.getAsset.mockReset().mockResolvedValue(null)
  h.existsSync.mockReset().mockReturnValue(false)
  h.readFileSync.mockReset().mockReturnValue(Buffer.from([]))
})

describe('GET /settings/branding/uploads/[filename]', () => {
  it('serves bytes from the DB with the stored content type', async () => {
    h.getAsset.mockResolvedValue({ ext: 'png', contentType: 'image/png', data: Buffer.from([1, 2, 3]) })
    const res = await callRoute(GET, { params: { filename: 'logo.png' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.equals(Buffer.from([1, 2, 3]))).toBe(true)
    expect(h.getAsset).toHaveBeenCalledWith('default', 'branding', 'logo')
  })

  it('falls back to disk when the DB has no row', async () => {
    h.existsSync.mockImplementation((p: string) => p.endsWith('logo.png'))
    h.readFileSync.mockReturnValue(Buffer.from([9, 9]))
    const res = await callRoute(GET, { params: { filename: 'logo.png' } })
    expect(res.status).toBe(200)
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.equals(Buffer.from([9, 9]))).toBe(true)
  })

  it('404 when neither DB nor disk has it', async () => {
    const res = await callRoute(GET, { params: { filename: 'missing.png' } })
    expect(res.status).toBe(404)
  })
})
