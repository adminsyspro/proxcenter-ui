import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireProviderAdminMock = vi.fn().mockResolvedValue(null)
const requireFeatureMock = vi.fn().mockResolvedValue(null)

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

// Provider-only route: requireProviderAdmin stands for the tenant gate AND
// admin.settings, so one mock covers both.
vi.mock('@/lib/tenant/providerGuard', () => ({ requireProviderAdmin: requireProviderAdminMock }))

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: requireFeatureMock,
}))

vi.mock('@/lib/orchestrator/headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

// POST is wrapped by withAudit() (#1105); the real audit() would reach Prisma
// and the syslog forwarder.
const auditMock = vi.fn()
vi.mock('@/lib/audit', () => ({ audit: auditMock }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderAdminMock.mockResolvedValue(null)
  requireFeatureMock.mockResolvedValue(null)
  auditMock.mockResolvedValue('audit-id')
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
    expect(requireProviderAdminMock).not.toHaveBeenCalled()
    // The refusal still leaves a row, from withAudit(): the route never audits itself.
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      category: 'system', action: 'create', resourceType: 'ha', status: 'failure', errorMessage: 'Feature not licensed',
      details: expect.objectContaining({ method: 'POST', httpStatus: 403 }),
    })
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
