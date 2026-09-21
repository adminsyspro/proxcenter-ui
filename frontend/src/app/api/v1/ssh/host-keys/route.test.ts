import { describe, expect, it, vi, beforeEach } from 'vitest'
import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const { checkPermissionMock, orchestratorFetchMock, listPinnedHostKeysMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  orchestratorFetchMock: vi.fn<(...a: any[]) => Promise<any>>(),
  listPinnedHostKeysMock: vi.fn<() => Promise<any[]>>(),
}))

vi.mock('@/lib/orchestrator', async () => {
  const actual = await vi.importActual<typeof import('@/lib/orchestrator')>('@/lib/orchestrator')
  return {
    ...actual,
    orchestratorFetch: (...args: unknown[]) => orchestratorFetchMock(...args),
  }
})

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
    CONNECTION_MANAGE: 'connection.manage',
  },
}))

vi.mock('@/lib/ssh/host-key-store', () => ({
  listPinnedHostKeys: () => listPinnedHostKeysMock(),
}))

import { GET } from './route'

/** Frontend store row shape: host carries ":port", timestamps are Dates. */
function frontendRow(host: string, keyType: string, firstSeen: string) {
  return {
    host,
    keyType,
    firstSeenAt: new Date(firstSeen),
    lastUsedAt: new Date(firstSeen),
  }
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  orchestratorFetchMock.mockReset().mockResolvedValue({ hosts: [] })
  listPinnedHostKeysMock.mockReset().mockResolvedValue([])
})

describe('GET /api/v1/ssh/host-keys', () => {
  it('merges both stores on the bare host, keeping the differing key types', async () => {
    orchestratorFetchMock.mockResolvedValue({
      hosts: [{ host: '10.42.0.101', key_type: 'ecdsa-sha2-nistp256', pinned_at: '2026-09-02T16:54:00Z' }],
    })
    listPinnedHostKeysMock.mockResolvedValue([
      frontendRow('10.42.0.101:22', 'ssh-ed25519', '2026-09-03T10:00:00Z'),
    ])

    const res = await callRoute(GET as Parameters<typeof callRoute>[0])

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      hosts: [
        {
          host: '10.42.0.101',
          keyTypes: ['ecdsa-sha2-nistp256', 'ssh-ed25519'],
          pinnedAt: '2026-09-02T16:54:00.000Z',
          sources: ['frontend', 'orchestrator'],
        },
      ],
      orchestratorUnavailable: false,
    })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/ssh/host-keys')
  })

  it('reports the earliest pin when the frontend saw the host first', async () => {
    orchestratorFetchMock.mockResolvedValue({
      hosts: [{ host: '10.42.0.101', key_type: 'ecdsa-sha2-nistp256', pinned_at: '2026-09-10T08:00:00Z' }],
    })
    listPinnedHostKeysMock.mockResolvedValue([
      frontendRow('10.42.0.101:22', 'ssh-ed25519', '2026-08-01T07:30:00Z'),
    ])

    const res = await callRoute(GET as Parameters<typeof callRoute>[0])
    const body = await readJson<any>(res)

    expect(body.hosts[0].pinnedAt).toBe('2026-08-01T07:30:00.000Z')
  })

  it('de-duplicates a key type both stores agree on, and folds every port of one host into one row', async () => {
    orchestratorFetchMock.mockResolvedValue({
      hosts: [{ host: '10.42.0.101', key_type: 'ssh-ed25519', pinned_at: '2026-09-02T16:54:00Z' }],
    })
    listPinnedHostKeysMock.mockResolvedValue([
      frontendRow('10.42.0.101:22', 'ssh-ed25519', '2026-09-03T10:00:00Z'),
      frontendRow('10.42.0.101:2222', 'ssh-rsa', '2026-09-04T10:00:00Z'),
    ])

    const res = await callRoute(GET as Parameters<typeof callRoute>[0])
    const body = await readJson<any>(res)

    expect(body.hosts).toHaveLength(1)
    expect(body.hosts[0].keyTypes).toEqual(['ssh-ed25519', 'ssh-rsa'])
  })

  it('sorts rows by host, keeps a store-only host, and leaves a port-less legacy row untouched', async () => {
    orchestratorFetchMock.mockResolvedValue({
      hosts: [{ host: 'pve-z', key_type: 'ecdsa-sha2-nistp256', pinned_at: '2026-09-02T16:54:00Z' }],
    })
    listPinnedHostKeysMock.mockResolvedValue([
      frontendRow('pve-legacy', 'ssh-rsa', '2026-01-01T00:00:00Z'),
      frontendRow('pve-a:22', 'ssh-ed25519', '2026-02-01T00:00:00Z'),
    ])

    const res = await callRoute(GET as Parameters<typeof callRoute>[0])
    const body = await readJson<any>(res)

    expect(body.hosts.map((h: any) => h.host)).toEqual(['pve-a', 'pve-legacy', 'pve-z'])
    expect(body.hosts[1]).toEqual({
      host: 'pve-legacy',
      keyTypes: ['ssh-rsa'],
      pinnedAt: '2026-01-01T00:00:00.000Z',
      sources: ['frontend'],
    })
    expect(body.hosts[2].sources).toEqual(['orchestrator'])
  })

  it('still lists the frontend pins with orchestratorUnavailable when the orchestrator is down', async () => {
    const err: any = new Error('Orchestrator unavailable')
    err.code = 'ORCHESTRATOR_UNAVAILABLE'
    orchestratorFetchMock.mockRejectedValue(err)
    listPinnedHostKeysMock.mockResolvedValue([
      frontendRow('10.42.0.101:22', 'ssh-ed25519', '2026-09-03T10:00:00Z'),
    ])

    const res = await callRoute(GET as Parameters<typeof callRoute>[0])

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      hosts: [
        {
          host: '10.42.0.101',
          keyTypes: ['ssh-ed25519'],
          pinnedAt: '2026-09-03T10:00:00.000Z',
          sources: ['frontend'],
        },
      ],
      orchestratorUnavailable: true,
    })
  })

  it('returns the denied response and reads nothing when the permission check fails', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(GET as Parameters<typeof callRoute>[0])

    expect(res.status).toBe(403)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
    expect(listPinnedHostKeysMock).not.toHaveBeenCalled()
  })

  it('returns 500 when the frontend store itself fails', async () => {
    listPinnedHostKeysMock.mockRejectedValue(new Error('db down'))

    const res = await callRoute(GET as Parameters<typeof callRoute>[0])

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'db down' })
  })
})
