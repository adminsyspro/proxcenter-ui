import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...a: any[]) => Promise<Response | null>>()
const fetchMock = vi.fn()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/orchestrator/headers', () => ({ orchestratorHeaders: (x: any) => ({ ...x }) }))

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
    expect((await readJson(res)).success).toBe(true)
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
    const body = await readJson(res)
    expect(body.success).toBe(false)
    expect(body.code).toBe('LICENSE_BINDING_MISMATCH')
    expect(body.expected_fingerprint).toBe('fp-expected')
    expect(body.actual_fingerprint).toBe('fp-actual')
  })

  it('returns 503 when the orchestrator is down', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    const res = await callRoute(await activatePOST(), { body: { license: 'BLOB' } })
    expect(res.status).toBe(503)
  })
})
