import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import type { CephRange } from '@/lib/ceph/types'

import { swrWrapper } from './testUtils'
import { OSD_IO_COLUMNS_POLL_MS, OSD_IO_COLUMNS_WARMUP_MAX, OSD_IO_COLUMNS_WARMUP_MS, OSD_IO_COLUMNS_STALE_MS, OSD_IO_NODES_PER_CALL, useOsdIoColumns, useOsdIoStore, type OsdIoRef } from './useOsdIoColumns'

const fetchMock = vi.fn()
let tabVisible = true

vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => tabVisible }))

const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
const counters = (opR: number, bytes = 0) => ({ node: 'pve1', op_r: opR, op_w: opR / 2, op_r_out_bytes: bytes, op_w_in_bytes: bytes * 2 })
const grouped = (at: number, osds: Record<string, unknown>, nodes: Record<string, { ok: boolean; reason?: unknown }> = { pve1: { ok: true } }) => res(200, { data: { at, nodes, osds } })
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const REFS: OsdIoRef[] = [{ id: 0, node: 'pve1' }]

function mount(opts: { conn?: string | null; range?: CephRange; enterprise?: boolean; refs?: OsdIoRef[]; enabled?: boolean } = {}) {
  return renderHook(() => {
    const store = useOsdIoStore()

    return useOsdIoColumns(opts.conn === undefined ? 'c1' : opts.conn, opts.range ?? 'live', opts.enterprise ?? false, opts.refs ?? REFS, opts.enabled ?? true, store)
  }, { wrapper: swrWrapper })
}

const exporterCalls = () => fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.includes('/ceph/exporter'))
const historyCalls = () => fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.includes('/history'))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  tabVisible = true
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useOsdIoColumns (live part)', () => {
  it('makes no call while the table is not shown, without a connection, or without a node', async () => {
    mount({ enabled: false })
    mount({ conn: null })
    mount({ refs: [{ id: 0, node: null }] })
    await flush(OSD_IO_COLUMNS_POLL_MS * 3)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the grouped route of the nodes of the rows, every 30 s, and derives the rates by difference', async () => {
    fetchMock
      .mockResolvedValueOnce(grouped(10_000, { 0: counters(1000, 1_000_000) }))
      .mockResolvedValueOnce(grouped(40_000, { 0: counters(1300, 4_000_000) }))
    const { result } = mount({ refs: [{ id: 0, node: 'pve 1' }, { id: 1, node: 'pve2' }, { id: 2, node: 'pve 1' }] })

    await flush()
    expect(exporterCalls()).toEqual(['/api/v1/connections/c1/ceph/exporter?nodes=pve%201,pve2'])
    expect(result.current.currentOf(0)).toBeUndefined()
    expect(result.current.stateOf('pve1')).toBe('ok')
    expect(result.current.stateOf('elsewhere')).toBe('pending')
    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(exporterCalls()).toHaveLength(2)
    expect(result.current.currentOf(0)).toEqual({ time: 40_000, readOps: 10, writeOps: 5, readBytes: 100_000, writeBytes: 200_000 })
  })

  it('takes the second reading 10 s after the first (twice the 5 s stats period of ceph-exporter), then every 30 s', async () => {
    expect(OSD_IO_COLUMNS_WARMUP_MS).toBe(10_000)
    fetchMock
      .mockResolvedValueOnce(grouped(10_000, { 0: counters(1000) }))
      .mockResolvedValueOnce(grouped(20_000, { 0: counters(1050) }))
      .mockResolvedValue(grouped(45_000, { 0: counters(1350) }))
    const { result } = mount()

    await flush()
    expect(exporterCalls()).toHaveLength(1)
    await flush(OSD_IO_COLUMNS_WARMUP_MS - 1)
    expect(exporterCalls()).toHaveLength(1)
    await flush(1)
    expect(exporterCalls()).toHaveLength(2)
    expect(result.current.currentOf(0)?.readOps).toBe(5)
    await flush(OSD_IO_COLUMNS_WARMUP_MS * 2)
    expect(exporterCalls()).toHaveLength(2)
    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(exporterCalls()).toHaveLength(3)
  })

  it('warms up at most three readings in a row (no rate comes), then falls back to 30 s', async () => {
    expect(OSD_IO_COLUMNS_WARMUP_MAX).toBe(3)
    // The counter goes down every time: a reading never makes a rate.
    let n = 100_000

    fetchMock.mockImplementation(async () => grouped(Date.now(), { 0: counters((n -= 1000)) }))
    const { result } = mount()

    await flush()
    expect(exporterCalls()).toHaveLength(1)
    await flush(OSD_IO_COLUMNS_WARMUP_MS * 3)
    expect(exporterCalls()).toHaveLength(4)
    // The cap is reached: the next reading is a normal period away, not 10 s.
    await flush(OSD_IO_COLUMNS_POLL_MS - 1)
    expect(exporterCalls()).toHaveLength(4)
    await flush(1)
    expect(exporterCalls()).toHaveLength(5)
    expect(result.current.currentOf(0)).toBeUndefined()
  })

  it('the warm-up counter starts over once a rate exists and when the connection changes', async () => {
    let at = 0
    let n = 0
    let conn = 'c1'
    let store: ReturnType<typeof useOsdIoStore> | undefined

    fetchMock.mockImplementation(async () => grouped((at += 10_000), { 0: counters((n += 300)) }))
    const { rerender } = renderHook(() => {
      store = useOsdIoStore()

      return useOsdIoColumns(conn, 'live', false, REFS, true, store)
    }, { wrapper: swrWrapper })

    await flush(OSD_IO_COLUMNS_WARMUP_MS)
    // First reading, then the second one made a rate: the warm-up is over and the counter is back to zero.
    expect(store?.warmups).toBe(0)
    store!.warmups = 2
    conn = 'c2'
    rerender()
    await flush()
    expect(store?.conn).toBe('c2')
    expect(store?.warmups).toBe(0)
  })

  it('a node that is down never warms up: it stays on the 30 s period', async () => {
    fetchMock.mockResolvedValue(grouped(10_000, {}, { pve1: { ok: false } }))
    const { result } = mount()

    await flush()
    expect(result.current.stateOf('pve1')).toBe('down')
    await flush(OSD_IO_COLUMNS_WARMUP_MS * 2)
    expect(exporterCalls()).toHaveLength(1)
    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(exporterCalls()).toHaveLength(2)
  })

  it('an OSD missing from the reading of a node that answers never warms up: it stays on the 30 s period', async () => {
    fetchMock.mockResolvedValue(grouped(10_000, { 7: counters(1000) }))
    const { result } = mount()

    await flush()
    expect(result.current.stateOf('pve1')).toBe('ok')
    await flush(OSD_IO_COLUMNS_WARMUP_MS * 2)
    expect(exporterCalls()).toHaveLength(1)
    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(exporterCalls()).toHaveLength(2)
  })

  it('a first reading and a counter that goes down make no point', async () => {
    fetchMock
      .mockResolvedValueOnce(grouped(10_000, { 0: counters(1000) }))
      .mockResolvedValueOnce(grouped(40_000, { 0: counters(5) }))
      .mockResolvedValueOnce(grouped(70_000, { 0: counters(305) }))
    const { result } = mount()

    // First reading, then a counter that went down (OSD restarted): no point, still warming up (10 s steps).
    await flush()
    await flush(OSD_IO_COLUMNS_WARMUP_MS)
    expect(exporterCalls()).toHaveLength(2)
    expect(result.current.seriesOf(0)).toEqual([])
    await flush(OSD_IO_COLUMNS_WARMUP_MS)
    expect(result.current.seriesOf(0).map(p => p.readOps)).toEqual([10])
  })

  it('splits more than 20 nodes into calls of at most 20', async () => {
    const refs = Array.from({ length: 45 }, (_, i) => ({ id: i, node: `n${String(i).padStart(2, '0')}` }))

    fetchMock.mockImplementation(async (url: string) => {
      const names = new URL(url, 'http://x').searchParams.get('nodes')!.split(',')

      return grouped(1000, {}, Object.fromEntries(names.map(n => [n, { ok: true }])))
    })
    const { result } = mount({ refs })

    await flush()
    const sizes = exporterCalls().map(u => new URL(u, 'http://x').searchParams.get('nodes')!.split(',').length)

    expect(sizes.sort((a, b) => b - a)).toEqual([OSD_IO_NODES_PER_CALL, OSD_IO_NODES_PER_CALL, 5])
    expect(result.current.stateOf('n44')).toBe('ok')
  })

  it('a node without exporter is down, a failed call is an error, and the other nodes keep their rates', async () => {
    fetchMock.mockResolvedValue(grouped(10_000, { 0: counters(1) }, { pve1: { ok: true }, pve2: { ok: false } }))
    const { result } = mount({ refs: [{ id: 0, node: 'pve1' }, { id: 1, node: 'pve2' }] })

    await flush()
    expect(result.current.stateOf('pve1')).toBe('ok')
    expect(result.current.stateOf('pve2')).toBe('down')

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(res(500, { error: 'x' }))
    const b = mount({ refs: [{ id: 0, node: 'pve1' }] })

    await flush()
    expect(b.result.current.stateOf('pve1')).toBe('error')

    fetchMock.mockReset()
    fetchMock.mockRejectedValue(new Error('network'))
    const c = mount({ refs: [{ id: 0, node: 'pve1' }] })

    await flush()
    expect(c.result.current.stateOf('pve1')).toBe('error')
  })

  it('keeps the reason of each node that is down; a node without reason, an unknown one, or one that is ok has none', async () => {
    fetchMock.mockResolvedValue(grouped(10_000, { 0: counters(1) }, {
      pve1: { ok: true },
      pve2: { ok: false, reason: 'refused' },
      pve3: { ok: false, reason: 'timeout' },
      pve4: { ok: false, reason: 'invalid' },
      pve5: { ok: false },
      pve6: { ok: false, reason: 'boom' },
    }))
    const { result } = mount({ refs: ['pve1', 'pve2', 'pve3', 'pve4', 'pve5', 'pve6'].map((node, id) => ({ id, node })) })

    await flush()
    expect(result.current.reasonOf('pve2')).toBe('refused')
    expect(result.current.reasonOf('pve3')).toBe('timeout')
    expect(result.current.reasonOf('pve4')).toBe('invalid')
    expect(result.current.stateOf('pve5')).toBe('down')
    expect(result.current.reasonOf('pve5')).toBeNull()
    expect(result.current.reasonOf('pve6')).toBeNull()
    expect(result.current.reasonOf('pve1')).toBeNull()
    expect(result.current.reasonOf(null)).toBeNull()
    expect(result.current.reasonOf('elsewhere')).toBeNull()
  })

  it('a node that comes back loses its reason, and a failed call leaves none', async () => {
    const replies = [
      grouped(10_000, {}, { pve1: { ok: false, reason: 'refused' } }),
      grouped(40_000, {}, { pve1: { ok: true } }),
      res(500, { error: 'x' }),
    ]
    // The port of the exporter is also read while a node is down: only the grouped route consumes a reply.
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/ceph/exporter?') ? replies.shift() : res(200, { data: { port: 9926 } })))
    const { result } = mount()

    await flush()
    expect(result.current.reasonOf('pve1')).toBe('refused')
    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.stateOf('pve1')).toBe('ok')
    expect(result.current.reasonOf('pve1')).toBeNull()

    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.stateOf('pve1')).toBe('error')
    expect(result.current.reasonOf('pve1')).toBeNull()
  })

  it('a reading 30 s + epsilon after the previous one is still one step (margin = twice the period)', async () => {
    fetchMock
      .mockResolvedValueOnce(grouped(10_000, { 0: counters(1000) }))
      .mockResolvedValueOnce(grouped(40_500, { 0: counters(1300) }))
    const { result } = mount()

    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.seriesOf(0)).toHaveLength(1)
  })

  it('an OSD missing from the reading of a node that answers loses its points, not only its reference', async () => {
    const t0 = Date.now()
    const refs = [{ id: 0, node: 'pve1' }, { id: 1, node: 'pve1' }]

    fetchMock
      .mockResolvedValueOnce(grouped(t0, { 0: counters(1000), 1: counters(1000) }))
      .mockResolvedValueOnce(grouped(t0 + 30_000, { 0: counters(1300), 1: counters(1300) }))
      .mockResolvedValueOnce(grouped(t0 + 60_000, { 0: counters(1600) }))
      .mockResolvedValueOnce(grouped(t0 + 90_000, { 0: counters(1900), 1: counters(2000) }))
    const { result } = mount({ refs })

    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.currentOf(1)).toBeDefined()
    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.currentOf(0)).toBeDefined()
    expect(result.current.currentOf(1)).toBeUndefined()
    expect(result.current.seriesOf(1)).toEqual([])
    // It comes back: a new reference first, so still no point on this reading.
    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.currentOf(1)).toBeUndefined()
  })

  it('a point older than three periods is never shown (back on the page after more than 5 minutes)', async () => {
    const t0 = Date.now()
    let enabled = true

    fetchMock
      .mockResolvedValueOnce(grouped(t0, { 0: counters(1000) }))
      .mockResolvedValueOnce(grouped(t0 + 30_000, { 0: counters(1300) }))
    const { result, rerender } = renderHook(() => {
      const store = useOsdIoStore()

      return useOsdIoColumns('c1', 'live', false, REFS, enabled, store)
    }, { wrapper: swrWrapper })

    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.currentOf(0)).toBeDefined()
    enabled = false
    rerender()
    await flush(OSD_IO_COLUMNS_STALE_MS + 1000)
    // Back on the table: the clock is read again at once, the aged point is hidden before any new reading arrives.
    fetchMock.mockReturnValue(new Promise(() => {}))
    enabled = true
    rerender()
    expect(result.current.currentOf(0)).toBeUndefined()
    expect(result.current.seriesOf(0)).toEqual([])
  })

  it.each([-600_000, 600_000])('a server clock off by %d ms neither hides fresh rates nor keeps stale ones', async skew => {
    const t0 = Date.now() + skew
    let enabled = true

    fetchMock
      .mockResolvedValueOnce(grouped(t0, { 0: counters(1000) }))
      .mockResolvedValueOnce(grouped(t0 + 30_000, { 0: counters(1300) }))
    const { result, rerender } = renderHook(() => {
      const store = useOsdIoStore()

      return useOsdIoColumns('c1', 'live', false, REFS, enabled, store)
    }, { wrapper: swrWrapper })

    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.currentOf(0)).toMatchObject({ readOps: 10 })
    enabled = false
    rerender()
    await flush(OSD_IO_COLUMNS_STALE_MS + 1000)
    fetchMock.mockReturnValue(new Promise(() => {}))
    enabled = true
    rerender()
    expect(result.current.currentOf(0)).toBeUndefined()
  })

  it('a point ages by the timer alone, with no re-render and no new reading', async () => {
    let at = 0
    let n = 0

    fetchMock.mockImplementation(async () => grouped((at += 30_000), { 0: counters((n += 300)) }))
    const { result } = mount()

    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.currentOf(0)).toBeDefined()
    // The exporter stops answering: no more points, the readings fail and the node goes to error. Freeze the store view
    // by making the reading hang, so only the clock moves.
    fetchMock.mockReturnValue(new Promise(() => {}))
    await flush(OSD_IO_COLUMNS_STALE_MS + OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.currentOf(0)).toBeUndefined()
    expect(result.current.seriesOf(0)).toEqual([])
  })

  it('runs no clock timer while the table is not shown', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval')

    mount({ enabled: false })
    await flush(OSD_IO_COLUMNS_POLL_MS * 2)
    expect(spy.mock.calls.filter(c => c[1] === OSD_IO_COLUMNS_POLL_MS)).toEqual([])
    spy.mockRestore()
  })

  it('reads the clock again when the tab becomes visible', async () => {
    let at = 0
    let n = 0

    fetchMock.mockImplementation(async () => grouped((at += 30_000), { 0: counters((n += 300)) }))
    const { result } = mount()

    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.currentOf(0)).toBeDefined()
    fetchMock.mockReturnValue(new Promise(() => {}))
    // A background tab: the browser freezes the timers; the clock jumps only on return.
    vi.setSystemTime(new Date(Date.now() + OSD_IO_COLUMNS_STALE_MS + 1000))
    expect(result.current.currentOf(0)).toBeDefined()
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current.currentOf(0)).toBeUndefined()
  })

  it('stops while the tab is hidden and resumes with a gap that makes no point', async () => {
    let at = 0
    let n = 0

    fetchMock.mockImplementation(async () => grouped((at += 30_000), { 0: counters((n += 300)) }))
    const { result, rerender } = mount()

    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(exporterCalls()).toHaveLength(2)
    tabVisible = false
    rerender()
    // Hidden for less than the staleness window: no call, and the point is still shown.
    await flush(OSD_IO_COLUMNS_POLL_MS * 2)
    expect(exporterCalls()).toHaveLength(2)
    expect(result.current.seriesOf(0)).toHaveLength(1)
  })

  it('keeps the curves when the table is closed and opened again (store owned by the caller)', async () => {
    let at = 0
    let n = 0

    fetchMock.mockImplementation(async () => grouped((at += 30_000), { 0: counters((n += 300)) }))
    let enabled = true
    const { result, rerender } = renderHook(() => {
      const store = useOsdIoStore()

      return useOsdIoColumns('c1', 'live', false, REFS, enabled, store)
    }, { wrapper: swrWrapper })

    await flush(OSD_IO_COLUMNS_POLL_MS * 2)
    expect(result.current.seriesOf(0)).toHaveLength(2)
    enabled = false
    rerender()
    // Closed for less than the staleness window (90 s): the curves are kept for the return.
    await flush(OSD_IO_COLUMNS_POLL_MS * 2)
    expect(exporterCalls()).toHaveLength(3)
    expect(result.current.seriesOf(0)).toHaveLength(2)
  })

  it('a stable refresh function: re-rendering more often than every 30 s does not restart the timer', async () => {
    let at = 0
    let n = 0

    fetchMock.mockImplementation(async () => grouped((at += 30_000), { 0: counters((n += 300)) }))
    const { rerender } = mount()

    for (let i = 0; i < 10; i++) {
      await flush(5000)
      rerender()
    }

    expect(exporterCalls().length).toBeGreaterThanOrEqual(2)
  })
})

describe('useOsdIoColumns (curves)', () => {
  const historyBody = (times: number[]) => res(200, { data: { points: [], slowest_osds: [], osd_io_series: { 0: times.map(t => ({ time: t, read_ops: 7, write_ops: 3, read_bytes: 70, write_bytes: 30 })) } } })

  it('Community: no history call, the curve is the session points', async () => {
    let at = 0
    let n = 0

    fetchMock.mockImplementation(async () => grouped((at += 30_000), { 0: counters((n += 300)) }))
    const { result } = mount()

    await flush(OSD_IO_COLUMNS_POLL_MS * 2)
    expect(historyCalls()).toEqual([])
    expect(result.current.source).toBe('session')
    expect(result.current.seriesOf(0)).toHaveLength(2)
  })

  it('Enterprise: reads osd_io for the ids of the rows (1 h in Live), history then session in Live, history alone over a period', async () => {
    let at = 1_000_000
    let n = 0

    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/history') ? historyBody([900, 940]) : grouped((at += 30_000), { 0: counters((n += 300)) })))
    const live = mount({ enterprise: true, refs: [{ id: 2, node: 'pve1' }, { id: 0, node: 'pve1' }] })

    await flush(OSD_IO_COLUMNS_POLL_MS * 2)
    expect(historyCalls()[0]).toBe('/api/v1/orchestrator/ceph/c1/history?range=1h&top=1&osds=0,2&osd_io=1')
    expect(live.result.current.source).toBe('history')
    expect(live.result.current.seriesOf(0).map(p => p.time)).toEqual([900_000, 940_000, 1_060_000, 1_090_000])
  })

  it('Enterprise over a period: the history alone is the curve, the current value stays the latest measured rate', async () => {
    let at = 0
    let n = 0

    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/history') ? historyBody([900, 940]) : grouped((at += 30_000), { 0: counters((n += 300)) })))
    const week = mount({ enterprise: true, range: '7d' })

    await flush(OSD_IO_COLUMNS_POLL_MS * 2)
    expect(historyCalls()[0]).toContain('range=7d')
    expect(week.result.current.seriesOf(0).map(p => p.time)).toEqual([900_000, 940_000])
    expect(week.result.current.currentOf(0)).toMatchObject({ readOps: 10 })
  })

  it('Enterprise: a 404 of the history is no data, never an error; at most 100 ids', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/history') ? res(404, {}) : grouped(1000, {})))
    const refs = Array.from({ length: 130 }, (_, i) => ({ id: i, node: 'pve1' }))
    const { result } = mount({ enterprise: true, refs, range: '24h' })

    await flush(OSD_IO_COLUMNS_POLL_MS)
    expect(result.current.seriesOf(0)).toEqual([])
    const ids = new URL(historyCalls()[0], 'http://x').searchParams.get('osds')!.split(',')

    expect(ids).toHaveLength(100)
  })
})
