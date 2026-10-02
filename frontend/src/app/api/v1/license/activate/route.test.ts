import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any) => ({ ...x }) }))

type ActivateBody = { success?: boolean; error?: string; code?: string; expected_fingerprint?: string; actual_fingerprint?: string }

async function activatePOST() { const mod = await import('./route'); return mod.POST as Parameters<typeof callRoute>[0] }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('POST /api/v1/license/activate', () => {
  it('400s when the license key is missing', async () => {
    const res = await callRoute(await activatePOST(), { body: {} })
    expect(res.status).toBe(400)
  })

  it('forwards a successful activation', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
    const res = await callRoute(await activatePOST(), { body: { license: 'BLOB' } })
    expect(res.status).toBe(200)
    expect((await readJson<ActivateBody>(res))?.success).toBe(true)
  })

  it('forwards the code and both fingerprints on a 409 binding mismatch', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        error: 'License bound to another install',
        code: 'LICENSE_BINDING_MISMATCH',
        expected_fingerprint: 'fp-expected',
        actual_fingerprint: 'fp-actual',
      }),
    })
    const res = await callRoute(await activatePOST(), { body: { license: 'BLOB' } })
    expect(res.status).toBe(409)
    expect(await readJson<ActivateBody>(res)).toEqual({
      success: false,
      error: 'License bound to another install',
      code: 'LICENSE_BINDING_MISMATCH',
      expected_fingerprint: 'fp-expected',
      actual_fingerprint: 'fp-actual',
    })
  })

  it('forwards a plain orchestrator error without code or fingerprints', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({}) })
    const res = await callRoute(await activatePOST(), { body: { license: 'BLOB' } })
    expect(res.status).toBe(422)
    expect(await readJson<ActivateBody>(res)).toEqual({ success: false, error: 'HTTP 422' })
  })

  it('returns 503 when the orchestrator is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    const res = await callRoute(await activatePOST(), { body: { license: 'BLOB' } })
    expect(res.status).toBe(503)
    expect((await readJson<ActivateBody>(res))?.code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })

  it('returns 500 with the error message on any other failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad JSON') } })
    const res = await callRoute(await activatePOST(), { body: { license: 'BLOB' } })
    expect(res.status).toBe(500)
    expect(await readJson<ActivateBody>(res)).toEqual({ success: false, error: 'bad JSON' })
  })
})
