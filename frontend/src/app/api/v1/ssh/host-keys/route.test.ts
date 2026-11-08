import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, listHostKeysMock, hostKeyScopeMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  listHostKeysMock: vi.fn<() => Promise<any[]>>(),
  hostKeyScopeMock: vi.fn<(...a: any[]) => Promise<{ all: boolean; hosts: Set<string> }>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/ssh/host-key-store', () => ({ listHostKeys: () => listHostKeysMock() }))

vi.mock('@/lib/ssh/hostKeyAccess', () => ({
  hostKeyScope: (...a: unknown[]) => hostKeyScopeMock(...a),
  hostKeyInScope: (scope: { all: boolean; hosts: Set<string> }, host: string) => scope.all || scope.hosts.has(host),
}))

import { bareHost, GET } from './route'

const KEYS = [
  { host: '10.0.0.1:22', keyType: 'ssh-ed25519', origin: 'confirmed' },
  { host: '10.0.0.2:2222', keyType: 'ssh-ed25519', origin: 'pending' },
  { host: 'fe80::1:22', keyType: 'ssh-ed25519', origin: 'automatic' },
  { host: '10.0.0.3', keyType: 'ecdsa-sha2-nistp256', origin: 'automatic', legacy: true },
]

function call() {
  return callRoute(GET as Parameters<typeof callRoute>[0], { method: 'GET' })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  hostKeyScopeMock.mockReset().mockResolvedValue({ all: true, hosts: new Set() })
  listHostKeysMock.mockReset().mockResolvedValue(KEYS)
})

describe('bareHost', () => {
  it('strips the port of a registry row and keeps a legacy row whole', () => {
    expect(bareHost('10.0.0.1:22')).toBe('10.0.0.1')
    expect(bareHost('FE80::1:2222')).toBe('fe80::1')
    expect(bareHost('10.0.0.3')).toBe('10.0.0.3')
    expect(bareHost('pve1.lab:ssh')).toBe('pve1.lab:ssh')
  })
})

describe('GET /api/v1/ssh/host-keys', () => {
  it('lists the whole registry for a caller who reaches every host', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ keys: KEYS })
  })

  it('lists only the hosts of the connections the caller may view', async () => {
    hostKeyScopeMock.mockResolvedValue({ all: false, hosts: new Set(['10.0.0.2', 'fe80::1']) })
    const body = await readJson<{ keys: { host: string }[] }>(await call())
    expect(body!.keys.map(k => k.host)).toEqual(['10.0.0.2:2222', 'fe80::1:22'])
  })

  it('returns the denied response and reads nothing when the permission check fails', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    expect((await call()).status).toBe(403)
    expect(listHostKeysMock).not.toHaveBeenCalled()
  })

  it('answers 500 when the registry fails', async () => {
    listHostKeysMock.mockRejectedValue(new Error('db down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call()).status).toBe(500)
    error.mockRestore()
  })
})
