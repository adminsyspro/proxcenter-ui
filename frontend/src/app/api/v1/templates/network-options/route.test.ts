// NOTE: Postgres is NOT available in this dev environment (POSTGRES_TEST_URL_BASE is unset).
// This route test runs in CI only. The pure mapper test (src/lib/templates/networkOptions.test.ts)
// covers the mapping logic locally.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { checkPermissionMock, vdcFindManyMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<() => Promise<Response | null>>(),
  vdcFindManyMock: vi.fn<(args?: any) => Promise<any[]>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    vdc: { findMany: vdcFindManyMock },
  }),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBNET_ROW = {
  cidr: '10.10.0.0/24',
  gateway: '10.10.0.1',
  dnsServers: '1.1.1.1,8.8.8.8',
}

const VNET_ROW = {
  pveName: 'abc12345',
  displayName: 'web-net',
  subnet: SUBNET_ROW,
}

const VDC_ROW = {
  id: 'vdc-001',
  slug: 'tenant-a-vdc',
  connectionId: 'conn-001',
  enabled: true,
  vnets: [VNET_ROW],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  vdcFindManyMock.mockResolvedValue([VDC_ROW])
})

describe('GET /api/v1/templates/network-options', () => {
  it('returns 200 with the flattened options list', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET)

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body).toHaveProperty('data.options')
    expect(Array.isArray(body.data.options)).toBe(true)
    expect(body.data.options).toHaveLength(1)

    const opt = body.data.options[0]
    expect(opt.pveName).toBe('abc12345')
    expect(opt.displayName).toBe('web-net')
    expect(opt.vdc).toBe('tenant-a-vdc')
    expect(opt.vdcId).toBe('vdc-001')
    expect(opt.connectionId).toBe('conn-001')
    expect(opt.subnet).toMatchObject({
      cidr: '10.10.0.0/24',
      gateway: '10.10.0.1',
      dnsServers: ['1.1.1.1', '8.8.8.8'],
    })
  })

  it('returns 403 when checkPermission denies', async () => {
    checkPermissionMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    )
    const { GET } = await import('./route')
    const res = await callRoute(GET)

    expect(res.status).toBe(403)
  })

  it('returns an empty options array when no vDCs exist', async () => {
    vdcFindManyMock.mockResolvedValue([])
    const { GET } = await import('./route')
    const res = await callRoute(GET)

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.options).toEqual([])
  })

  it('returns an empty options array when a vDC has no vnets', async () => {
    vdcFindManyMock.mockResolvedValue([
      { ...VDC_ROW, vnets: [] },
    ])
    const { GET } = await import('./route')
    const res = await callRoute(GET)

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.options).toEqual([])
  })

  it('falls back to pveName when vnet displayName is null', async () => {
    vdcFindManyMock.mockResolvedValue([
      {
        ...VDC_ROW,
        vnets: [{ pveName: 'xyz00001', displayName: null, subnet: null }],
      },
    ])
    const { GET } = await import('./route')
    const res = await callRoute(GET)

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.options[0].displayName).toBe('xyz00001')
    expect(body.data.options[0].subnet).toBeNull()
  })

  it('queries vdc.findMany with enabled:true', async () => {
    const { GET } = await import('./route')
    await callRoute(GET)

    expect(vdcFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true },
        include: { vnets: { include: { subnet: true } } },
      }),
    )
  })

  it('returns an empty list and does not throw when findMany rejects', async () => {
    vdcFindManyMock.mockRejectedValue(new Error('DB timeout'))
    const { GET } = await import('./route')
    const res = await callRoute(GET)

    // .catch(() => []) in the route means we still get 200 with empty options
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.options).toEqual([])
  })

  it('flattens vnets from multiple vDCs into one sorted list', async () => {
    vdcFindManyMock.mockResolvedValue([
      {
        id: 'vdc-a', slug: 'alpha', connectionId: 'conn-1', enabled: true,
        vnets: [{ pveName: 'zzz00001', displayName: 'zeta', subnet: null }],
      },
      {
        id: 'vdc-b', slug: 'beta', connectionId: 'conn-2', enabled: true,
        vnets: [
          { pveName: 'aaa00001', displayName: 'apple', subnet: null },
          { pveName: 'mmm00001', displayName: 'mango', subnet: null },
        ],
      },
    ])
    const { GET } = await import('./route')
    const res = await callRoute(GET)

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.options).toHaveLength(3)
    expect(body.data.options.map((o: any) => o.displayName)).toEqual(['apple', 'mango', 'zeta'])
  })
})
