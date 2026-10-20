import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const listActiveLocksMock = vi.fn<() => Promise<any[]>>()
const unlockLoginMock = vi.fn<(kind: string, key: string) => Promise<boolean>>()
const auditMock = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_COMPLIANCE: 'admin.compliance' },
}))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/auth/loginLockout', () => ({
  listActiveLocks: listActiveLocksMock,
  unlockLogin: unlockLoginMock,
}))
vi.mock('@/lib/audit', async () => {
  // audit() flips the request's audit scope so withAudit() adds no row of its
  // own (#1105); the stand-in must do the same or every explicit row doubles.
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return auditMock(...a) } }
})

const { GET, DELETE } = await import('./route')

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
})

describe('/api/v1/compliance/login-lockouts', () => {
  it('GET is refused without admin.compliance', async () => {
    checkPermissionMock.mockResolvedValue(new Response('forbidden', { status: 403 }) as any)
    const res = await callRoute(GET)
    expect(res.status).toBe(403)
    expect(listActiveLocksMock).not.toHaveBeenCalled()
  })

  it('GET lists the active locks', async () => {
    listActiveLocksMock.mockResolvedValue([{ kind: 'ip', key: '203.0.113.1' }])
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: [{ kind: 'ip', key: '203.0.113.1' }] })
  })

  it('DELETE validates kind and key', async () => {
    const res = await callRoute(DELETE, { method: 'DELETE', searchParams: { kind: 'user', key: 'x' } })
    expect(res.status).toBe(400)
    expect(unlockLoginMock).not.toHaveBeenCalled()
  })

  it('DELETE unlocks and audits login_unlocked', async () => {
    unlockLoginMock.mockResolvedValue(true)
    const res = await callRoute(DELETE, { method: 'DELETE', searchParams: { kind: 'account', key: 'a@b.com' } })
    expect(res.status).toBe(200)
    expect(unlockLoginMock).toHaveBeenCalledWith('account', 'a@b.com')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_unlocked', resourceId: 'a@b.com' }))
  })

  it('DELETE answers 404 when nothing was locked', async () => {
    unlockLoginMock.mockResolvedValue(false)
    const res = await callRoute(DELETE, { method: 'DELETE', searchParams: { kind: 'ip', key: '203.0.113.1' } })
    expect(res.status).toBe(404)
    // The route never reached its own audit(): the refusal row is withAudit()'s.
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      category: 'security', action: 'delete', resourceType: 'login_lockout', status: 'failure', errorMessage: 'Not found',
      details: expect.objectContaining({ method: 'DELETE', httpStatus: 404, query: { kind: 'ip', key: '203.0.113.1' } }),
    })
  })
})
