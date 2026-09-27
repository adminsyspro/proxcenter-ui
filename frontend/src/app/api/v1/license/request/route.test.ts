import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any) => ({ ...x }) }))

async function requestGET() { const mod = await import('./route'); return mod.GET }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('GET /api/v1/license/request', () => {
  it('403s when the caller lacks admin.settings', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await (await requestGET())()
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('streams the signed request file with the orchestrator file name', async () => {
    const file = JSON.stringify({ format: 1, request: 'AAA', signature: 'BBB' })
    fetchMock.mockResolvedValue(new Response(file, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="proxcenter-license-request-abcd1234.json"' },
    }))
    const res = await (await requestGET())()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="proxcenter-license-request-abcd1234.json"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe(file)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/license\/request$/)
  })

  it('forwards the orchestrator error and code', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no key', code: 'IDENTITY_SIGNING_UNAVAILABLE' }), { status: 409 }))
    const res = await (await requestGET())()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ success: false, error: 'no key', code: 'IDENTITY_SIGNING_UNAVAILABLE' })
  })

  it('503s with ORCHESTRATOR_UNAVAILABLE when the orchestrator is down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (await requestGET())()
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })
})
