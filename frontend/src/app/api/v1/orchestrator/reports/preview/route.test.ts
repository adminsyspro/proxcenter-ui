import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  getCurrentTenantId: vi.fn(async () => 'default'),
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: h.checkPermission, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId, DEFAULT_TENANT_ID: 'default' }))

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { DEFAULT_REPORT_TEMPLATE } from '@/lib/reports/templateSettings'
import { POST } from './route'

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue('default')
  h.fetchMock.mockReset().mockResolvedValue(new Response(Buffer.from('%PDF-1.7 x'), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Length': '10' },
  }))
  vi.stubGlobal('fetch', h.fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /orchestrator/reports/preview', () => {
  it('returns a permission denial without calling the orchestrator', async () => {
    h.checkPermission.mockResolvedValue(new Response('no', { status: 403 }) as any)

    const res = await callRoute(POST as any, { body: {} })

    expect(res.status).toBe(403)
    expect(h.fetchMock).not.toHaveBeenCalled()
  })

  it('refuses imported CSS without calling the orchestrator', async () => {
    const res = await callRoute(POST as any, { body: { template: { customCss: '@import url(http://x)' } } })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: '@import is not allowed in custom CSS', code: 'import' })
    expect(h.fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-object body', async () => {
    const res = await callRoute(POST as any, { body: 'not json' })

    expect(res.status).toBe(400)
    expect(h.fetchMock).not.toHaveBeenCalled()
  })

  it('returns the sidecar PDF and sends a normalized French template', async () => {
    const expectedBytes = Buffer.from('%PDF-1.7 x')

    const res = await callRoute(POST as any, { body: { language: 'fr', template: { pageSize: 'A3' } } })

    expect(h.fetchMock).toHaveBeenCalledOnce()
    const [url, init] = h.fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/v1\/reports\/preview$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ language: 'fr', template: DEFAULT_REPORT_TEMPLATE })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="report-preview.pdf"')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(expectedBytes)
  })

  it('defaults the language to English', async () => {
    await callRoute(POST as any, { body: { template: {} } })

    const payload = JSON.parse(h.fetchMock.mock.calls[0][1].body)
    expect(payload.language).toBe('en')
  })

  it('includes a tenant header for a non-default tenant', async () => {
    h.getCurrentTenantId.mockResolvedValue('acme')

    await callRoute(POST as any, { body: {} })

    expect(h.fetchMock.mock.calls[0][1].headers['X-Tenant-ID']).toBe('acme')
  })

  it('omits the tenant header for the default tenant', async () => {
    await callRoute(POST as any, { body: {} })

    expect(h.fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID')
  })

  it('passes through a JSON orchestrator error', async () => {
    h.fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ error: 'custom CSS must not contain </style>' }),
      { status: 400 },
    ))

    const res = await callRoute(POST as any, { body: {} })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'custom CSS must not contain </style>' })
  })

  it('passes through a plain-text orchestrator error', async () => {
    h.fetchMock.mockResolvedValue(new Response('renderer down', { status: 503 }))

    const res = await callRoute(POST as any, { body: {} })

    expect(res.status).toBe(503)
    expect(await readJson(res)).toEqual({ error: 'renderer down' })
  })

  it('returns 504 when the orchestrator request is aborted', async () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    h.fetchMock.mockRejectedValue(error)

    const res = await callRoute(POST as any, { body: {} })

    expect(res.status).toBe(504)
    expect(await readJson(res)).toEqual({ error: 'Report preview timed out' })
  })
})
