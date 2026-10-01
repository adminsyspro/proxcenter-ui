import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any = {}) => ({ ...x, 'X-API-Key': 'k' }) }))

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
const fetchMock = vi.fn()

async function logoGET() { const mod = await import('./route'); return mod.GET }

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('GET /api/v1/license/partner-logo', () => {
  it('streams the orchestrator image with private caching and nosniff', async () => {
    fetchMock.mockResolvedValue(new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png', ETag: '"abc"' } }))
    const res = await (await logoGET())(new Request('http://localhost/api/v1/license/partner-logo'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('etag')).toBe('"abc"')
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(PNG))
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/license\/connection\/partner-logo$/)
  })

  it('forwards If-None-Match and answers 304', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 304, headers: { ETag: '"abc"' } }))
    const res = await (await logoGET())(new Request('http://localhost/x', { headers: { 'If-None-Match': '"abc"' } }))
    expect(res.status).toBe(304)
    expect(fetchMock.mock.calls[0][1].headers['If-None-Match']).toBe('"abc"')
  })

  it('answers 404 without a logo, for an unexpected type, and when the orchestrator is down', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }))
    expect((await (await logoGET())(new Request('http://localhost/x'))).status).toBe(404)
    fetchMock.mockResolvedValueOnce(new Response('<svg/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } }))
    expect((await (await logoGET())(new Request('http://localhost/x'))).status).toBe(404)
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'))
    expect((await (await logoGET())(new Request('http://localhost/x'))).status).toBe(404)
  })
})
