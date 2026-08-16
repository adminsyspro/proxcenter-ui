import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { pveFetchMock, checkPermissionMock, getConnByIdMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getConnByIdMock: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: any[]) => getConnByIdMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { NODE_VIEW: 'node.view' },
}))

const POOL_LIST = { name: 'DS', size: 10, alloc: 4, free: 6, frag: '0%', dedup: 1, health: 'ONLINE' }

// Real PVE 9.1 detail: no `status`, no `action`, and `scan` is a sentence.
const POOL_DETAIL = {
  name: 'DS', state: 'ONLINE', leaf: 0,
  scan: 'scrub repaired 0B in 00:00:00 with 0 errors on Sun Jul 12 00:24:01 2026',
  errors: 'No known data errors',
  children: [{ name: 'sdb', leaf: 1, state: 'ONLINE', read: 0, write: 0, cksum: 0 }],
}

const SMART_TEXT = { health: 'OK', type: 'text', text: 'Current Drive Temperature: 0 C' }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnByIdMock.mockResolvedValue({ id: 'c1', baseUrl: 'https://pve', apiToken: 'tok' })
})

const get = async (searchParams: Record<string, string> = {}) => {
  const { GET } = await import('./route')

  return callRoute(GET, { params: { id: 'c1', node: 'pve1' }, searchParams })
}

describe('GET .../nodes/[node]/disks ZFS section', () => {
  beforeEach(() => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.endsWith('/disks/zfs')) return [POOL_LIST]
      if (path.includes('/disks/zfs/')) return POOL_DETAIL

      return []
    })
  })

  it('exposes state, scan and errors from the detail call', async () => {
    const body = await readJson<any>(await get({ section: 'zfs' }))
    const pool = body.data.zfs[0]

    expect(pool.state).toBe('ONLINE')
    expect(pool.scan).toContain('scrub repaired 0B')
    expect(pool.errors).toBe('No known data errors')
  })

  it('exposes the vdev children', async () => {
    const body = await readJson<any>(await get({ section: 'zfs' }))

    expect(body.data.zfs[0].children).toEqual([
      { name: 'sdb', leaf: 1, state: 'ONLINE', read: 0, write: 0, cksum: 0 },
    ])
  })

  it('no longer carries the status and action fields PVE does not return', async () => {
    const body = await readJson<any>(await get({ section: 'zfs' }))
    const pool = body.data.zfs[0]

    expect(pool).not.toHaveProperty('status')
    expect(pool).not.toHaveProperty('action')
  })

  it('keeps the list-level fields when the detail call fails', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.endsWith('/disks/zfs')) return [POOL_LIST]
      if (path.includes('/disks/zfs/')) throw new Error('detail boom')

      return []
    })

    const body = await readJson<any>(await get({ section: 'zfs' }))
    const pool = body.data.zfs[0]

    expect(pool.name).toBe('DS')
    expect(pool.health).toBe('ONLINE')
    expect(pool.state).toBeNull()
  })
})

describe('GET .../nodes/[node]/disks SMART branch', () => {
  it('does not call the SMART endpoint without a disk param', async () => {
    pveFetchMock.mockResolvedValue([])
    await get({ section: 'disks' })

    expect(pveFetchMock.mock.calls.some(([, p]: [any, string]) => p.includes('/disks/smart'))).toBe(false)
  })

  it('returns the SMART payload when a disk is given', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.includes('/disks/smart')) return SMART_TEXT

      return []
    })

    const body = await readJson<any>(await get({ section: 'disks', disk: '/dev/sda' }))

    expect(body.data.smart).toEqual(SMART_TEXT)
  })

  it('url-encodes the disk path', async () => {
    pveFetchMock.mockResolvedValue([])
    await get({ section: 'disks', disk: '/dev/sda' })

    const call = pveFetchMock.mock.calls.find(([, p]: [any, string]) => p.includes('/disks/smart'))

    expect(call?.[1]).toBe('/nodes/pve1/disks/smart?disk=%2Fdev%2Fsda')
  })

  it('returns a null smart payload rather than failing when SMART errors', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.includes('/disks/smart')) throw new Error('smartctl boom')

      return []
    })

    const res = await get({ section: 'disks', disk: '/dev/sda' })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data.smart).toBeNull()
  })
})

describe('GET .../nodes/[node]/disks guards', () => {
  it('returns 400 when a param is missing', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'c1' } })

    expect(res.status).toBe(400)
  })

  it('propagates a denied permission', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))

    expect((await get({ section: 'disks' })).status).toBe(403)
  })

  it('returns 500 when the connection cannot be resolved', async () => {
    getConnByIdMock.mockRejectedValue(new Error('Connection not found: c1'))

    const res = await get({ section: 'disks' })

    expect(res.status).toBe(500)
  })
})
