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

describe('GET login-background/serve/[filename]', () => {
  it('serves bytes from the DB', async () => {
    h.getAsset.mockResolvedValue({ ext: 'jpg', contentType: 'image/jpeg', data: Buffer.from([5, 6]) })
    const res = await callRoute(GET, { params: { filename: 'background.jpg' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from([5, 6]))).toBe(true)
    expect(h.getAsset).toHaveBeenCalledWith('default', 'login-bg', 'background')
  })

  it('falls back to disk when the DB has no row', async () => {
    h.existsSync.mockImplementation((p: string) => p.endsWith('background.png'))
    h.readFileSync.mockReturnValue(Buffer.from([1]))
    const res = await callRoute(GET, { params: { filename: 'background.png' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('404 when neither DB nor disk has it', async () => {
    const res = await callRoute(GET, { params: { filename: 'background.png' } })
    expect(res.status).toBe(404)
  })
})
