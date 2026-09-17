import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { NextResponse } from 'next/server'

import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const demoResponseMock = vi.fn<(req: Request) => Response | null>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const assertVdcPbsAccessMock = vi.fn<(id: string) => Promise<any>>()
const getPbsConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const getPbsConnectionByIdUnscopedMock = vi.fn<(id: string) => Promise<any>>()
const pbsFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/demo/demo-api', () => ({
  demoResponse: demoResponseMock,
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
}))

vi.mock('@/lib/vdc/scope', () => ({
  assertVdcPbsAccess: assertVdcPbsAccessMock,
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionById: getPbsConnectionByIdMock,
  getPbsConnectionByIdUnscoped: getPbsConnectionByIdUnscopedMock,
}))

vi.mock('@/lib/proxmox/pbs-client', () => ({
  pbsFetch: pbsFetchMock,
}))

// The clipping is what this PR added, so rrdRange stays REAL: the assertions
// below measure the window the route actually served.
const importGET = async () => (await import('./route')).GET

const NOW = 1_800_000_000

// Six points, 30 min apart, the newest one just before `now`.
const point = (time: number, over: Record<string, number> = {}) => ({
  time,
  cpu: 0.25,
  memtotal: 1_000,
  memused: 250,
  swaptotal: 0,
  swapused: 0,
  roottotal: 2_000,
  rootused: 500,
  ...over,
})

const ROWS = [
  point(NOW - 9_000),
  point(NOW - 7_200),
  point(NOW - 5_400),
  point(NOW - 3_600),
  point(NOW - 1_800),
  point(NOW - 600),
]

/** URL of every pbsFetch call, in order. */
const fetchedUrls = () => pbsFetchMock.mock.calls.map(call => String(call[1]))

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW * 1000)
  demoResponseMock.mockReturnValue(null)
  checkPermissionMock.mockResolvedValue(null)
  assertVdcPbsAccessMock.mockResolvedValue({ kind: 'admin' })
  getPbsConnectionByIdMock.mockResolvedValue({ id: 'pbs1' })
  getPbsConnectionByIdUnscopedMock.mockResolvedValue({ id: 'pbs1' })
  pbsFetchMock.mockResolvedValue(ROWS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/v1/pbs/:id/rrd', () => {
  it('serves a preset timeframe with no window', async () => {
    const res = await callRoute(await importGET(), {
      params: { id: 'pbs1' },
      searchParams: { timeframe: 'day' },
    })

    expect(res.status).toBe(200)

    const json = await readJson<any>(res)

    expect(json.data).toHaveLength(ROWS.length)
    expect(json.timeframe).toBe('day')
    expect(json.cf).toBe('AVERAGE')
    expect(json.meta.window).toBeNull()
    expect(json.meta.points).toBe(ROWS.length)

    // Step measured on the points that came back, not read from a table.
    expect(json.meta.stepSeconds).toBe(1_800)

    expect(fetchedUrls()[0]).toContain('timeframe=day')
    expect(fetchedUrls()[0]).toContain('cf=AVERAGE')
  })

  it('maps the PBS point into the series the charts read', async () => {
    pbsFetchMock.mockResolvedValue([
      point(NOW - 600, { cpu: 0.4242, memtotal: 800, memused: 200, swaptotal: 100, swapused: 25 }),
    ])

    const json = await readJson<any>(
      await callRoute(await importGET(), { params: { id: 'pbs1' } }),
    )

    expect(json.data[0]).toMatchObject({
      time: NOW - 600,
      cpu: 42.42,
      memUsedPercent: 25,
      swapUsedPercent: 25,
      rootUsedPercent: 25,
    })
  })

  it('passes an explicit consolidation function through', async () => {
    await callRoute(await importGET(), {
      params: { id: 'pbs1' },
      searchParams: { timeframe: 'hour', cf: 'MAX' },
    })

    expect(fetchedUrls()[0]).toContain('cf=MAX')
  })

  it('clips to a custom window and reports what it served', async () => {
    const from = NOW - 7_200
    const to = NOW - 3_600

    const res = await callRoute(await importGET(), {
      params: { id: 'pbs1' },
      searchParams: { timeframe: 'hour', from: String(from), to: String(to) },
    })

    const json = await readJson<any>(res)

    expect(json.data.map((p: any) => p.time)).toEqual([from, NOW - 5_400, to])
    expect(json.meta.window).toEqual({ from, to })
    expect(json.meta.points).toBe(3)
    expect(json.meta.stepSeconds).toBe(1_800)

    // A two-hour lookback no longer fits the `hour` archive, so the route asks
    // PBS for the next one up and clips here.
    expect(json.timeframe).toBe('day')
    expect(fetchedUrls()[0]).toContain('timeframe=day')
  })

  it('falls through to the legacy endpoints when the first answers empty', async () => {
    pbsFetchMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(ROWS)

    const res = await callRoute(await importGET(), { params: { id: 'pbs1' } })

    expect(res.status).toBe(200)

    const urls = fetchedUrls()

    expect(urls[0]).toContain('/nodes/localhost/rrd')
    expect(urls[1]).toContain('/status/rrd')

    const json = await readJson<any>(res)

    expect(json.data).toHaveLength(ROWS.length)
  })

  it('tries the third endpoint when the first two reject', async () => {
    pbsFetchMock
      .mockRejectedValueOnce(new Error('404'))
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce(ROWS)

    const res = await callRoute(await importGET(), { params: { id: 'pbs1' } })

    expect(res.status).toBe(200)
    expect(fetchedUrls()[2]).toContain('/rrd?timeframe=')
  })

  it('answers an empty series when no endpoint has data', async () => {
    pbsFetchMock.mockResolvedValue([])

    const json = await readJson<any>(
      await callRoute(await importGET(), { params: { id: 'pbs1' } }),
    )

    expect(json).toEqual({ data: [] })
    expect(pbsFetchMock).toHaveBeenCalledTimes(3)
  })

  it('400s without an id', async () => {
    const res = await callRoute(await importGET(), { params: {} })

    expect(res.status).toBe(400)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('returns the demo payload before touching PBS', async () => {
    demoResponseMock.mockReturnValue(NextResponse.json({ data: [] }))

    const res = await callRoute(await importGET(), { params: { id: 'pbs1' } })

    expect(res.status).toBe(200)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('returns the 403 from checkPermission without fetching', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse('Permission denied: backup.view'))

    const res = await callRoute(await importGET(), { params: { id: 'pbs1' } })

    expect(res.status).toBe(403)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('returns the vDC scope refusal as is', async () => {
    assertVdcPbsAccessMock.mockResolvedValue(
      NextResponse.json({ error: 'PBS not accessible for this tenant' }, { status: 403 }),
    )

    const res = await callRoute(await importGET(), { params: { id: 'pbs1' } })

    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toEqual({ error: 'PBS not accessible for this tenant' })
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('reads the connection unscoped for a tenant-scoped caller', async () => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: 'vdc', namespaces: ['tenant-a'] })

    await callRoute(await importGET(), { params: { id: 'pbs1' } })

    expect(getPbsConnectionByIdUnscopedMock).toHaveBeenCalledWith('pbs1')
    expect(getPbsConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('500s when the connection lookup throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    getPbsConnectionByIdMock.mockRejectedValue(new Error('connection gone'))

    const res = await callRoute(await importGET(), { params: { id: 'pbs1' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'connection gone' })
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
