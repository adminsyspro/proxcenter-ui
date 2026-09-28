import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any) => ({ ...x }) }))

async function checkinPOST() { const mod = await import('./route'); return mod.POST }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('POST /api/v1/license/checkin', () => {
  it('403s when the caller lacks admin.settings', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await (await checkinPOST())()
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards the queued answer with status 202', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, queued: true }), { status: 202 }))
    const res = await (await checkinPOST())()
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ success: true, queued: true })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/license\/checkin$/)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('forwards NOT_CONNECTED with status 409', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, error: 'not connected', code: 'NOT_CONNECTED' }), { status: 409 }))
    const res = await (await checkinPOST())()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ success: false, error: 'not connected', code: 'NOT_CONNECTED' })
  })

  it('503s with ORCHESTRATOR_UNAVAILABLE when the orchestrator is down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await (await checkinPOST())()
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })
})
