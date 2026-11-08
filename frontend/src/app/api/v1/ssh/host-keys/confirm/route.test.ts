import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, confirmHostKeyMock, hostKeyScopeMock, getPrincipalMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  confirmHostKeyMock: vi.fn<(endpoint: string, fingerprint: string, by: string) => Promise<boolean>>(),
  hostKeyScopeMock: vi.fn<(...a: any[]) => Promise<{ all: boolean; hosts: Set<string> }>>(),
  getPrincipalMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/auth/principal', () => ({ getPrincipal: () => getPrincipalMock() }))

vi.mock('@/lib/ssh/host-key-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ssh/host-key-store')>('@/lib/ssh/host-key-store')

  return {
    hostKeyEndpoint: actual.hostKeyEndpoint,
    listHostKeys: vi.fn(),
    confirmHostKey: (e: string, f: string, b: string) => confirmHostKeyMock(e, f, b),
  }
})

vi.mock('@/lib/ssh/hostKeyAccess', () => ({
  hostKeyScope: (...a: unknown[]) => hostKeyScopeMock(...a),
  hostKeyInScope: (scope: { all: boolean; hosts: Set<string> }, host: string) => scope.all || scope.hosts.has(host),
}))

import { POST } from './route'

const FP = `SHA256:${'A'.repeat(43)}`

function call(body: unknown) {
  return callRoute(POST as Parameters<typeof callRoute>[0], { method: 'POST', body: body as any })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  hostKeyScopeMock.mockReset().mockResolvedValue({ all: true, hosts: new Set() })
  confirmHostKeyMock.mockReset().mockResolvedValue(true)
  getPrincipalMock.mockReset().mockResolvedValue({ ok: true, principal: { kind: 'session', userEmail: 'ops@example.com' } })
})

describe('POST /api/v1/ssh/host-keys/confirm', () => {
  it('confirms the key with the fingerprint the operator saw, in the operator name', async () => {
    const res = await call({ host: 'PVE1.Lab:22', fingerprint: FP })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: 'confirmed', host: 'pve1.lab:22', fingerprint: FP })
    expect(confirmHostKeyMock).toHaveBeenCalledWith('pve1.lab:22', FP, 'ops@example.com')
  })

  it('confirms an IPv6 endpoint', async () => {
    expect((await call({ host: 'fe80::1:2222', fingerprint: FP })).status).toBe(200)
    expect(confirmHostKeyMock).toHaveBeenCalledWith('fe80::1:2222', FP, 'ops@example.com')
  })

  it('answers 404 when the key changed since it was shown', async () => {
    confirmHostKeyMock.mockResolvedValue(false)
    const res = await call({ host: '10.0.0.1:22', fingerprint: FP })
    expect(res.status).toBe(404)
    expect((await readJson<{ error: string }>(res))!.error).toMatch(/test the connection again/)
  })

  it.each([
    [{ host: '10.0.0.1', fingerprint: FP }],
    [{ host: '10.0.0.1:0', fingerprint: FP }],
    [{ host: '10.0.0.1:70000', fingerprint: FP }],
    [{ host: 'a/b:22', fingerprint: FP }],
    [{ host: '10.0.0.1:22', fingerprint: 'MD5:aa' }],
    [{ host: 42, fingerprint: FP }],
    [null],
  ])('rejects a malformed request %j', async (body) => {
    expect((await call(body)).status).toBe(400)
    expect(confirmHostKeyMock).not.toHaveBeenCalled()
  })

  it('refuses an API token: a trust decision needs a signed-in operator', async () => {
    getPrincipalMock.mockResolvedValue({ ok: true, principal: { kind: 'token', userEmail: 'bot@example.com' } })
    expect((await call({ host: '10.0.0.1:22', fingerprint: FP })).status).toBe(403)
    expect(confirmHostKeyMock).not.toHaveBeenCalled()
  })

  it('answers 404 outside the caller scope', async () => {
    hostKeyScopeMock.mockResolvedValue({ all: false, hosts: new Set(['10.0.0.2']) })
    expect((await call({ host: '10.0.0.1:22', fingerprint: FP })).status).toBe(404)
    expect(confirmHostKeyMock).not.toHaveBeenCalled()
  })

  it('returns the denied response first', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    expect((await call({ host: '10.0.0.1:22', fingerprint: FP })).status).toBe(403)
    expect(confirmHostKeyMock).not.toHaveBeenCalled()
  })

  it('answers 500 when the registry fails', async () => {
    confirmHostKeyMock.mockRejectedValue(new Error('db down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call({ host: '10.0.0.1:22', fingerprint: FP })).status).toBe(500)
    error.mockRestore()
  })
})
