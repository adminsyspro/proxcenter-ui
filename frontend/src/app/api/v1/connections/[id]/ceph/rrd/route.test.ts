import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

// rrdRange stays REAL: the point of these tests is the window the route serves.
const importGET = async () => (await import('./route')).GET

const NOW = 1_800_000_000

const point = (time: number, over: Record<string, number> = {}) => ({
  time,
  cpu: 0.25,
  memtotal: 1_000,
  memused: 250,
  netin: 10,
  netout: 20,
  ...over,
})

// Six points, 30 min apart, the newest just before `now`.
const ROWS = [
  point(NOW - 9_000),
  point(NOW - 7_200),
  point(NOW - 5_400),
  point(NOW - 3_600),
  point(NOW - 1_800),
  point(NOW - 600),
]

const CEPH_STATUS = {
  pgmap: { read_bytes_sec: 1_024, write_bytes_sec: 2_048, read_op_per_sec: 5, write_op_per_sec: 7 },
}

const CEPH_POOLS = [
  { pool_name: 'rbd', pool: 2, bytes_used: 500, percent_used: 0.25, max_avail: 2_000, objects: 42 },
]

const CEPH_OSDS = {
  root: {
    children: [
      { type: 'host', name: 'pve1', children: [
        { type: 'osd', id: 1, name: 'osd.1', up: 1, in: 1, device_class: 'ssd', commit_latency_ms: 4, apply_latency_ms: 2 },
        { type: 'osd', id: 0, name: 'osd.0', up: 1, in: 1, device_class: 'ssd', commit_latency_ms: 2, apply_latency_ms: 1 },
      ] },
    ],
  },
}

type Plan = { nodes?: any; rrd?: any; status?: any; pools?: any; osds?: any }

/**
 * The handler walks several PVE endpoints and swallows the failures of the
 * Ceph ones, so the mock routes by URL. A plan entry may be a rejection.
 */
function stubPve(plan: Plan = {}) {
  const answer = (value: any) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value))

  pveFetchMock.mockImplementation((_conn: any, path: string) => {
    if (path === '/nodes') return answer(plan.nodes ?? [{ node: 'pve1', status: 'online' }])
    if (path.includes('/rrddata')) return answer(plan.rrd ?? ROWS)
    if (path.includes('/ceph/status')) return answer(plan.status ?? CEPH_STATUS)
    if (path.includes('/ceph/pool')) return answer(plan.pools ?? CEPH_POOLS)
    if (path.includes('/ceph/osd')) return answer(plan.osds ?? CEPH_OSDS)

    return Promise.resolve(null)
  })
}

/** The rrddata path the route asked for, or undefined if it never asked. */
const rrdPath = () =>
  pveFetchMock.mock.calls.map(call => String(call[1])).find(path => path.includes('/rrddata'))

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW * 1000)
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'conn1' })
  stubPve()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/v1/connections/:id/ceph/rrd', () => {
  it('serves a preset timeframe with no window', async () => {
    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { timeframe: 'day' },
    })

    expect(res.status).toBe(200)

    const { data } = await readJson<any>(res)

    expect(data.timeframe).toBe('day')
    expect(data.window).toBeNull()
    expect(data.nodeName).toBe('pve1')
    expect(data.rrd).toHaveLength(ROWS.length)
    expect(data.rrd[0]).toMatchObject({ time: NOW - 9_000, cpu: 25, memPct: 25, netIn: 10, netOut: 20 })

    // Step measured on the points that came back, not read from a table.
    expect(data.stepSeconds).toBe(1_800)
    expect(rrdPath()).toContain('timeframe=day')
  })

  it('clips to a custom window and reports what it served', async () => {
    const from = NOW - 7_200
    const to = NOW - 3_600

    const { data } = await readJson<any>(
      await callRoute(await importGET(), {
        params: { id: 'conn1' },
        searchParams: { timeframe: 'hour', from: String(from), to: String(to) },
      }),
    )

    expect(data.rrd.map((p: any) => p.time)).toEqual([from, NOW - 5_400, to])
    expect(data.window).toEqual({ from, to })
    expect(data.stepSeconds).toBe(1_800)

    // Two hours back no longer fits the `hour` archive, so the route fetches
    // the next one up and clips here.
    expect(data.timeframe).toBe('day')
    expect(rrdPath()).toContain('timeframe=day')
  })

  it('drops the points that carry no timestamp', async () => {
    stubPve({ rrd: [point(NOW - 600), { cpu: 0.5 }, { time: 0, cpu: 0.5 }] })

    const { data } = await readJson<any>(
      await callRoute(await importGET(), { params: { id: 'conn1' } }),
    )

    expect(data.rrd).toHaveLength(1)
    expect(data.rrd[0].time).toBe(NOW - 600)
  })

  it('still answers when the node RRD call fails', async () => {
    stubPve({ rrd: new Error('rrddata unavailable') })

    const res = await callRoute(await importGET(), {
      params: { id: 'conn1' },
      searchParams: { from: String(NOW - 7_200), to: String(NOW - 3_600) },
    })

    expect(res.status).toBe(200)

    const { data } = await readJson<any>(res)

    expect(data.rrd).toEqual([])

    // No points to measure, so the nominal step of the chosen archive.
    expect(data.stepSeconds).toBe(60)
  })

  it('reports the real-time Ceph metrics alongside the series', async () => {
    const { data } = await readJson<any>(
      await callRoute(await importGET(), { params: { id: 'conn1' } }),
    )

    expect(data.current).toMatchObject({ readBytesSec: 1_024, writeOpsSec: 7 })
    expect(data.pools).toEqual([
      { name: 'rbd', id: 2, bytesUsed: 500, percentUsed: 0.25, maxAvail: 2_000, objects: 42 },
    ])

    // OSDs come out of the CRUSH tree, flattened and sorted by id.
    expect(data.osds.map((o: any) => o.id)).toEqual([0, 1])
    expect(data.latency).toEqual({ avgCommit: 3, avgApply: 1.5, maxCommit: 4, maxApply: 2 })
    expect(data.iops).toMatchObject({ read: 5, write: 7, total: 12 })
  })

  it('survives every Ceph endpoint failing', async () => {
    stubPve({
      status: new Error('no ceph'),
      pools: new Error('no ceph'),
      osds: new Error('no ceph'),
    })

    const { data } = await readJson<any>(
      await callRoute(await importGET(), { params: { id: 'conn1' } }),
    )

    expect(data.current).toBeNull()
    expect(data.pools).toEqual([])
    expect(data.osds).toEqual([])
    expect(data.latency).toEqual({ avgCommit: 0, avgApply: 0, maxCommit: 0, maxApply: 0 })
    expect(data.iops).toBeNull()
  })

  it('falls back to the first node when none is online', async () => {
    stubPve({ nodes: [{ node: 'pve-down', status: 'offline' }, { node: 'pve2', status: 'offline' }] })

    const { data } = await readJson<any>(
      await callRoute(await importGET(), { params: { id: 'conn1' } }),
    )

    expect(data.nodeName).toBe('pve-down')
    expect(rrdPath()).toContain('/nodes/pve-down/rrddata')
  })

  it('404s on a connection with no node', async () => {
    stubPve({ nodes: [] })

    const res = await callRoute(await importGET(), { params: { id: 'conn1' } })

    expect(res.status).toBe(404)
    expect(await readJson<any>(res)).toEqual({ error: 'No nodes found' })
  })

  it('400s without an id', async () => {
    const res = await callRoute(await importGET(), { params: {} })

    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns the 403 from checkPermission without fetching', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse('Permission denied: connection.view'))

    const res = await callRoute(await importGET(), { params: { id: 'conn1' } })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500s when the node list call throws', async () => {
    stubPve({ nodes: new Error('cluster unreachable') })

    const res = await callRoute(await importGET(), { params: { id: 'conn1' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'cluster unreachable' })
  })
})
