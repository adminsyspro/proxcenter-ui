import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn().mockResolvedValue(null)
const requireFeatureMock = vi.fn().mockResolvedValue(null)

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: requireFeatureMock,
}))

vi.mock('@/lib/orchestrator/headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  requireFeatureMock.mockResolvedValue(null)
})

describe('POST /api/v1/ha/deploy', () => {
  it('starts deployment', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { method: 'POST' })
    const data = await readJson(res)

    expect(res.status).toBe(200)
    expect(data).toEqual({ ok: true })
  })

  it('rejects when deployment already in progress', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, error: 'deployment already in progress' }),
    })

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { method: 'POST' })

    expect(res.status).toBe(409)
  })

  it('returns 503 when orchestrator unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { method: 'POST' })

    expect(res.status).toBe(503)
  })

  it('returns 403 when control_plane_ha is not licensed, before RBAC is checked', async () => {
    const { NextResponse } = await import('next/server')
    requireFeatureMock.mockResolvedValue(
      NextResponse.json({ error: 'Feature not licensed', feature: 'control_plane_ha' }, { status: 403 })
    )

    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { method: 'POST' })
    const data = await readJson(res)

    expect(res.status).toBe(403)
    expect(data).toEqual({ error: 'Feature not licensed', feature: 'control_plane_ha' })
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/ha/deploy/status', () => {
  it('returns SSE stream from orchestrator', async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"step":1,"status":"done"}\n\n'))
        controller.close()
      },
    })
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: mockBody,
    })

    const { GET } = await import('./status/route')
    const res = await callRoute(GET as any)

    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const text = await res.text()
    expect(text).toContain('step')
  })

  it('returns error when no body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    })

    const { GET } = await import('./status/route')
    const res = await callRoute(GET as any)

    expect(res.status).toBe(200)
  })

  it('reports a stream cut mid-flight as 504, not as an unavailable orchestrator (#803)', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
      })
    )

    const { GET } = await import('./status/route')
    const res = await callRoute(GET as any)
    const data = (await readJson(res)) as { error: string }

    expect(res.status).toBe(504)
    expect(data.error).toContain('closed the connection')
  })
})
