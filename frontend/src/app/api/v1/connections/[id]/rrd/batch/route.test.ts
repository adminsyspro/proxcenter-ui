import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const getRBACContextMock = vi.fn<() => Promise<any>>()
const hasPermissionMock = vi.fn<(check: any) => Promise<boolean>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  getRBACContext: getRBACContextMock,
  hasPermission: hasPermissionMock,
  PERMISSIONS: { VM_VIEW: 'vm.view', NODE_VIEW: 'node.view' },
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  buildNodeResourceId: (c: string, n: string) => `${c}:${n}`,
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

// Dynamic import so the route (and its mocked deps) loads after the mock
// consts above are initialized — the repo convention for route tests.
const importPOST = async () => (await import('./route')).POST

beforeEach(() => {
  vi.clearAllMocks()
  getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 'default' })
  getConnectionByIdMock.mockResolvedValue({ id: 'conn1' })
  pveFetchMock.mockImplementation(async (_conn: any, rrdPath: string) => [{ path: rrdPath }])
})

describe('POST /api/v1/connections/:id/rrd/batch', () => {
  it('401s when unauthenticated', async () => {
    getRBACContextMock.mockResolvedValue(null)

    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: { paths: ['/nodes/pve1'], timeframe: 'hour' },
    })

    expect(res.status).toBe(401)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('drops paths the caller cannot see and only fetches the allowed ones', async () => {
    // pve1 allowed, pve2 denied.
    hasPermissionMock.mockImplementation(async (check) => check.resourceId === 'conn1:pve1')

    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: { paths: ['/nodes/pve1', '/nodes/pve2'], timeframe: 'hour' },
    })

    expect(res.status).toBe(200)
    // Each node path checked against node.view on its node resource.
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'node.view', resourceType: 'node', resourceId: 'conn1:pve1' }),
    )
    const json = await readJson<{ data: Record<string, unknown> }>(res)
    expect(Object.keys(json!.data)).toEqual(['/nodes/pve1'])
    // Only the allowed node was fetched.
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns an empty map when no path is allowed', async () => {
    hasPermissionMock.mockResolvedValue(false)

    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: { paths: ['/nodes/pve1', '/nodes/pve2'], timeframe: 'hour' },
    })

    expect(res.status).toBe(200)
    const json = await readJson<{ data: Record<string, unknown> }>(res)
    expect(json?.data).toEqual({})
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* Custom window: one window clipped across the whole batch (#955)     */
/* ------------------------------------------------------------------ */

describe('POST /api/v1/connections/:id/rrd/batch — custom window', () => {
  const NOW = 1_800_000_000

  const point = (time: number) => ({ time, cpu: 0.25 })

  // Six points, 30 min apart, the newest just before `now`.
  const ROWS = [
    point(NOW - 9_000),
    point(NOW - 7_200),
    point(NOW - 5_400),
    point(NOW - 3_600),
    point(NOW - 1_800),
    point(NOW - 600),
  ]

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW * 1000)
    hasPermissionMock.mockResolvedValue(true)
    pveFetchMock.mockResolvedValue(ROWS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clips every path to the same window and reports it once', async () => {
    const from = NOW - 7_200
    const to = NOW - 3_600

    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: { paths: ['/nodes/pve1', '/nodes/pve2'], timeframe: 'hour', from, to },
    })

    expect(res.status).toBe(200)

    const json = await readJson<any>(res)
    const kept = [from, NOW - 5_400, to]

    expect(json.data['/nodes/pve1'].map((p: any) => p.time)).toEqual(kept)
    expect(json.data['/nodes/pve2'].map((p: any) => p.time)).toEqual(kept)

    // One meta for the batch, measured on the points that came back.
    expect(json.meta).toMatchObject({ from, to, points: 3, stepSeconds: 1_800, truncated: false })

    // A two-hour lookback no longer fits the `hour` archive, so the whole batch
    // is fetched from the next one up and clipped here.
    expect(json.meta.timeframe).toBe('day')
    expect(String(pveFetchMock.mock.calls[0][1])).toContain('timeframe=day')
  })

  it('reports the served range for a plain preset request', async () => {
    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: { paths: ['/nodes/pve1', '/nodes/pve2'] },
    })

    const json = await readJson<any>(res)

    // No timeframe in the body either: the route defaults to the hour archive.
    expect(String(pveFetchMock.mock.calls[0][1])).toContain('timeframe=hour')
    expect(json.meta).toMatchObject({
      timeframe: 'hour',
      from: NOW - 9_000,
      to: NOW - 600,
      points: ROWS.length,
      truncated: false,
    })
  })

  it('flags a window older than what Proxmox keeps', async () => {
    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: {
        paths: ['/nodes/pve1', '/nodes/pve2'],
        timeframe: 'hour',
        from: NOW - 40_000_000,
        to: NOW - 600,
      },
    })

    const json = await readJson<any>(res)

    expect(json.meta.truncated).toBe(true)
    expect(json.meta.timeframe).toBe('year')
  })

  it('drops a path whose fetch rejected, keeping the others', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, rrdPath: string) => {
      if (rrdPath.includes('pve2')) throw new Error('node unreachable')

      return ROWS
    })

    const json = await readJson<any>(
      await callRoute(await importPOST(), {
        params: { id: 'conn1' },
        body: { paths: ['/nodes/pve1', '/nodes/pve2'], timeframe: 'hour' },
      }),
    )

    expect(Object.keys(json.data)).toEqual(['/nodes/pve1'])
  })
})

/* ------------------------------------------------------------------ */
/* Request guards                                                      */
/* ------------------------------------------------------------------ */

describe('POST /api/v1/connections/:id/rrd/batch — guards', () => {
  beforeEach(() => {
    hasPermissionMock.mockResolvedValue(true)
  })

  it('400s without an id', async () => {
    const res = await callRoute(await importPOST(), { params: {}, body: { paths: ['/nodes/pve1'] } })

    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('answers an empty map for a body with no path', async () => {
    const res = await callRoute(await importPOST(), { params: { id: 'conn1' }, body: {} })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: {} })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('refuses more than 50 paths', async () => {
    const paths = Array.from({ length: 51 }, (_, i) => `/nodes/pve${i}`)

    const res = await callRoute(await importPOST(), { params: { id: 'conn1' }, body: { paths } })

    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({ error: 'Too many paths (max 50)' })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500s when the connection lookup throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    getConnectionByIdMock.mockRejectedValue(new Error('connection gone'))

    const res = await callRoute(await importPOST(), {
      params: { id: 'conn1' },
      body: { paths: ['/nodes/pve1'], timeframe: 'hour' },
    })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'connection gone' })
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
