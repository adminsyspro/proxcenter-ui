import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, forgetHostKeyMock, hostKeyScopeMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  forgetHostKeyMock: vi.fn<(host: string) => Promise<number>>(),
  hostKeyScopeMock: vi.fn<(...a: any[]) => Promise<{ all: boolean; hosts: Set<string> }>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/ssh/host-key-store', () => ({
  forgetHostKey: (host: string) => forgetHostKeyMock(host),
  listHostKeys: vi.fn(),
}))

// Which hosts a caller reaches is hostKeyAccess.test.ts's business; here the
// route only has to ask it and honour the answer.
vi.mock('@/lib/ssh/hostKeyAccess', () => ({
  hostKeyScope: (...a: unknown[]) => hostKeyScopeMock(...a),
  hostKeyInScope: (scope: { all: boolean; hosts: Set<string> }, host: string) => scope.all || scope.hosts.has(host),
}))

import { DELETE } from './route'

function call(host: string) {
  return callRoute(DELETE as Parameters<typeof callRoute>[0], { method: 'DELETE', params: { host } })
}

beforeEach(() => {
  hostKeyScopeMock.mockReset().mockResolvedValue({ all: true, hosts: new Set() })
  checkPermissionMock.mockReset().mockResolvedValue(null)
  forgetHostKeyMock.mockReset().mockResolvedValue(2)
})

describe('DELETE /api/v1/ssh/host-keys/[host]', () => {
  it('forgets every key of a bare host, lower-cased', async () => {
    const res = await call('PVE1.Lab')
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: 'forgotten', host: 'pve1.lab', removed: 2 })
    expect(forgetHostKeyMock).toHaveBeenCalledWith('pve1.lab')
  })

  it('forgets one endpoint given as host:port, scoped on its bare host', async () => {
    hostKeyScopeMock.mockResolvedValue({ all: false, hosts: new Set(['10.0.0.1']) })
    const res = await call('10.0.0.1:2222')
    expect(res.status).toBe(200)
    expect(forgetHostKeyMock).toHaveBeenCalledWith('10.0.0.1:2222')
  })

  it('answers 404 when nothing was stored for the host', async () => {
    forgetHostKeyMock.mockResolvedValue(0)
    expect((await call('10.0.0.9')).status).toBe(404)
  })

  it('answers 404 and forgets nothing outside the caller scope', async () => {
    hostKeyScopeMock.mockResolvedValue({ all: false, hosts: new Set(['10.0.0.1']) })
    expect((await call('10.0.0.2')).status).toBe(404)
    expect(forgetHostKeyMock).not.toHaveBeenCalled()
  })

  it('rejects a host with a slash or a space', async () => {
    expect((await call('a/b')).status).toBe(400)
    expect((await call('a b')).status).toBe(400)
    expect(forgetHostKeyMock).not.toHaveBeenCalled()
  })

  it('returns the denied response without touching the registry', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    expect((await call('10.0.0.1')).status).toBe(403)
    expect(forgetHostKeyMock).not.toHaveBeenCalled()
  })

  it('answers 500 when the registry fails', async () => {
    forgetHostKeyMock.mockRejectedValue(new Error('db down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call('10.0.0.1')).status).toBe(500)
    error.mockRestore()
  })
})
