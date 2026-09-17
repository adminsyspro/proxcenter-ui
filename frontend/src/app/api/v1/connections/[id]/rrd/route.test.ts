import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const demoResponseMock = vi.fn<(req: Request) => Response | null>()

// Mock the rbac barrel: checkPermission is the gate under test; the pure
// PERMISSIONS / build* helpers are reimplemented so the REAL resolveRrdScope
// (not mocked) produces the resource ids we assert on.
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { VM_VIEW: 'vm.view', NODE_VIEW: 'node.view', CONNECTION_VIEW: 'connection.view' },
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  buildNodeResourceId: (c: string, n: string) => `${c}:${n}`,
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('@/lib/demo/demo-api', () => ({
  demoResponse: demoResponseMock,
}))

// Dynamic import so the route (and its mocked deps) loads after the mock
// consts above are initialized — the repo convention for route tests.
const importGET = async () => (await import('./route')).GET

beforeEach(() => {
  vi.clearAllMocks()
  demoResponseMock.mockReturnValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'conn1' })
  pveFetchMock.mockResolvedValue([{ time: 1, cpu: 0.5 }])
})

describe('GET /api/v1/connections/:id/rrd', () => {
  it('gates a VM path on vm.view scoped to the VM resource', async () => {
    checkPermissionMock.mockResolvedValue(null)

    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { path: '/nodes/pve1/qemu/100', timeframe: 'hour' },
    })

    expect(checkPermissionMock).toHaveBeenCalledWith('vm.view', 'vm', 'conn1:pve1:qemu:100')
    expect(res.status).toBe(200)
    const json = await readJson<{ data: unknown[] }>(res)
    expect(json?.data).toEqual([{ time: 1, cpu: 0.5 }])
  })

  it('gates a node path on node.view scoped to the node resource', async () => {
    checkPermissionMock.mockResolvedValue(null)

    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { path: '/nodes/pve1', timeframe: 'day' },
    })

    expect(checkPermissionMock).toHaveBeenCalledWith('node.view', 'node', 'conn1:pve1')
    expect(res.status).toBe(200)
  })

  it('returns the 403 from checkPermission when the user lacks the scope', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse('Permission denied: vm.view'))

    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { path: '/nodes/pve1/qemu/100' },
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid path before any permission check', async () => {
    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { path: '/cluster/resources' },
    })

    expect(res.status).toBe(400)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('400s when the connection id is missing', async () => {
    const res = await callRoute(await importGET(), {
      params: {},
      searchParams: { path: '/nodes/pve1' },
    })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/connections/:id/rrd with a custom window', () => {
  const NOW = 1_800_000_000

  // 24 h of one-minute points, which is exactly what PVE 9 serves for `day`.
  const dayRows = Array.from({ length: 1440 }, (_, i) => ({ time: NOW - (1439 - i) * 60, cpu: i / 1440 }))

  beforeEach(() => {
    checkPermissionMock.mockResolvedValue(null)
    vi.useFakeTimers()
    vi.setSystemTime(NOW * 1000)
    pveFetchMock.mockResolvedValue(dayRows)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches the finest archive reaching the window and clips to it', async () => {
    const from = NOW - 7_200
    const to = from + 600

    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { path: '/nodes/pve1', timeframe: 'year', from: String(from), to: String(to) },
    })

    // `timeframe=year` in the query is ignored: the window is 2 h old, so the
    // 60 s archive (24 h deep) still covers it.
    expect(pveFetchMock).toHaveBeenCalledWith({ id: 'conn1' }, '/nodes/pve1/rrddata?timeframe=day&cf=AVERAGE')

    const json = await readJson<{ data: any[]; meta: any }>(res)

    expect(json?.data).toHaveLength(11)
    expect(json?.data[0].time).toBe(from)
    expect(json?.data[json.data.length - 1].time).toBe(to)
    expect(json?.meta).toMatchObject({ timeframe: 'day', stepSeconds: 60, points: 11, truncated: false })
  })

  it('flags a start older than what Proxmox keeps instead of pretending', async () => {
    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { path: '/nodes/pve1', from: String(NOW - 40_000_000), to: String(NOW) },
    })

    expect(pveFetchMock).toHaveBeenCalledWith({ id: 'conn1' }, '/nodes/pve1/rrddata?timeframe=year&cf=AVERAGE')

    const json = await readJson<{ meta: any }>(res)

    expect(json?.meta.truncated).toBe(true)
  })

  it('falls back to the preset when the window is unusable', async () => {
    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { path: '/nodes/pve1', timeframe: 'week', from: String(NOW), to: String(NOW - 600) },
    })

    expect(pveFetchMock).toHaveBeenCalledWith({ id: 'conn1' }, '/nodes/pve1/rrddata?timeframe=week&cf=AVERAGE')

    const json = await readJson<{ data: any[]; meta: any }>(res)

    expect(json?.data).toHaveLength(1440)
    expect(json?.meta.timeframe).toBe('week')
  })

  it('reports an empty window rather than silently widening it', async () => {
    // Shorter than the 60 s step: there is simply nothing in between.
    const from = NOW - 3_630

    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { path: '/nodes/pve1', from: String(from), to: String(from + 20) },
    })

    const json = await readJson<{ data: any[]; meta: any }>(res)

    expect(json?.data).toEqual([])
    expect(json?.meta).toMatchObject({ points: 0, stepSeconds: 60 })
  })
})
