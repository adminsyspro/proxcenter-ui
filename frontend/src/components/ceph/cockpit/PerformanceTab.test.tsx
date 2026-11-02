import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import en from '@/messages/en.json'
import type { CephHistory } from '@/lib/orchestrator/client'
import type { CephInventory, CephLive, CephRange } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import PerformanceTab, { PerfTooltip } from './PerformanceTab'
import { tickAxisWidth } from '@/lib/ceph/perfSeries'
import { toneColor, uncleanColor } from './ui'
import { FILL_COLUMN, lgStyle } from './fillTestUtils'

const areaTypes: string[] = []
const yAxes: { yAxisId?: string; width?: number; ticks?: number[]; tickFormatter?: (v: number) => string }[] = []
let history: { history: CephHistory | null; loading: boolean; error: Error | null } = { history: null, loading: false, error: null }
const historyCalls: unknown[][] = []
const lastHourCalls: unknown[][] = []
let lastHour: CephHistory | null = null

vi.mock('./hooks/useCephHistory', () => ({
  useCephHistory: (...args: unknown[]) => {
    historyCalls.push(args)

    return history
  },
  useCephLastHour: (...args: unknown[]) => {
    lastHourCalls.push(args)

    return { history: args[1] ? lastHour : null, loading: false, error: null }
  },
}))
// jsdom has no layout: the responsive container would give the chart a zero size.
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>()

  // Light stand-ins: jsdom has no layout, so the real chart draws nothing. They record the props of every series.
  const Area = (props: Record<string, unknown>) => {
    areaTypes.push(String(props.type))

    return null
  }
  const Passive = () => null
  const YAxis = (props: (typeof yAxes)[number]) => {
    yAxes.push(props)

    return null
  }
  const AreaChart = ({ children }: { children: React.ReactNode }) => <svg>{children}</svg>

  return { ...actual, Area, AreaChart, XAxis: Passive, YAxis, CartesianGrid: Passive, Tooltip: Passive, ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div style={{ width: 600, height: 170 }}>{children}</div> }
})

const theme = createTheme()

const liveOf = (at: number, over: Partial<CephLive> = {}): CephLive => ({
  health: { status: 'HEALTH_OK', checks: [] },
  pg: { total: 129, clean: 120, byState: [] },
  osd: { total: 3, up: 3, in: 3 },
  io: { readOps: 94, writeOps: 11, readBytes: 1000, writeBytes: 500 },
  recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 0 },
  raw: { used: 1, total: 2 },
  at,
  ...over,
})

const osd = (id: number, ms: number, host = 'pve1') => ({
  id, name: `osd.${id}`, host, status: 'up', up: true, in: true, deviceClass: 'hdd', totalBytes: 0, usedBytes: 0, availBytes: 0,
  usedPct: 1, commitLatencyMs: ms, applyLatencyMs: ms, version: '20.2.4',
})

const inventoryOf = (osds: ReturnType<typeof osd>[]) => ({ hasCeph: true, osds: { total: osds.length, list: osds } }) as unknown as CephInventory

const point = (time: number) => ({
  time, health: 0 as const, read_ops: 10, write_ops: 5, read_bytes: 1000, write_bytes: 500, recovering_bytes: 0,
  degraded_objects: 0, misplaced_objects: 0, pgs_total: 10, pgs_clean: 10, raw_used_bytes: 1, raw_total_bytes: 2,
  osd_total: 3, osd_up: 3, osd_in: 3, osd_lat_avg_ms: 4, osd_lat_max_ms: 9,
})

function propsOf(over: { buffer?: CephLive[]; range?: CephRange; enterprise?: boolean; inventory?: CephInventory | null } = {}): CockpitTabProps {
  return {
    conn: 'c1',
    live: { live: null, buffer: over.buffer ?? [], error: null, lastOkAt: 1, absent: false, stale: false, refresh: vi.fn() },
    inventory: { inventory: over.inventory === undefined ? inventoryOf([osd(0, 2), osd(1, 9), osd(2, 3)]) : over.inventory, absent: false, error: null, lastOkAt: 1, stale: false, reload: vi.fn() },
    url: { conn: 'c1', tab: 'perf', item: null, filter: 'all', range: over.range ?? 'live', hosts: 'all', map: null, set: vi.fn() },
    enterprise: over.enterprise ?? true,
    ratios: { nearfull: 0.85, full: 0.95 },
    focus: null,
    osdFlags: {} as CockpitTabProps['osdFlags'],
    latencyBuffer: {},
    onNavigate: vi.fn(),
  }
}

function renderTab(props: CockpitTabProps) {
  render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={theme}>
        <PerformanceTab {...props} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )

  return props
}

const buffer = (n: number) => Array.from({ length: n }, (_, i) => liveOf(1_700_000_000_000 + i * 5000))

beforeEach(() => {
  history = { history: null, loading: false, error: null }
  historyCalls.length = 0
  lastHourCalls.length = 0
  lastHour = null
  areaTypes.length = 0
  yAxes.length = 0
})

afterEach(cleanup)

describe('PerformanceTab', () => {
  it('wide: a 2 x 2 grid fills the height, the charts grow from their current height and the slowest card stretches', () => {
    renderTab(propsOf({ buffer: buffer(5) }))

    expect(lgStyle(screen.getByTestId('perf-grid'))).toMatchObject({
      flex: '1 1 auto', 'min-height': '0px', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', 'grid-template-rows': 'repeat(2, 1fr)',
    })
    for (const id of ['perf-iops', 'perf-throughput', 'perf-recovery', 'perf-slowest']) expect(lgStyle(screen.getByTestId(id))).toMatchObject(FILL_COLUMN)
    for (const chart of screen.getAllByTestId('perf-chart')) {
      expect(lgStyle(chart)).toMatchObject({ flex: '1 1 0px', 'min-height': '170px', position: 'relative', height: 'auto' })
    }
    for (const plot of screen.getAllByTestId('perf-chart-plot')) expect(lgStyle(plot)).toMatchObject({ position: 'absolute' })
  })

  it('no node metric series rendered: no /rrd call, only the three Ceph charts', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    renderTab(propsOf({ buffer: buffer(5) }))
    expect(screen.getAllByTestId('perf-chart')).toHaveLength(3)
    expect(fetchSpy.mock.calls.filter(c => String(c[0]).includes('rrd'))).toHaveLength(0)
    expect(screen.queryByText(/cpu|memory|ram/i)).toBeNull()
    fetchSpy.mockRestore()
  })

  it('draws the Live buffer and asks no history', () => {
    renderTab(propsOf({ buffer: buffer(5) }))

    expect(historyCalls.at(-1)).toEqual(['c1', 'live', true])
    for (const id of ['perf-iops', 'perf-throughput', 'perf-recovery']) expect(within(screen.getByTestId(id)).getByTestId('perf-chart')).toBeInTheDocument()
    expect(screen.getByText(en.cephCockpit.perf.series.unclean)).toBeInTheDocument()
  })

  it('waits for two Live points instead of drawing an empty axis', () => {
    renderTab(propsOf({ buffer: buffer(1) }))

    expect(screen.queryByTestId('perf-chart')).toBeNull()
    expect(screen.getAllByTestId('perf-live-waiting')).toHaveLength(3)
  })

  it('empty history shows empty state', () => {
    history = { history: { from: '', to: '', step: 300, points: [point(1)], slowest_osds: [] }, loading: false, error: null }
    renderTab(propsOf({ range: '24h' }))

    expect(screen.queryByTestId('perf-chart')).toBeNull()
    expect(screen.getAllByTestId('trend-empty')).toHaveLength(3)
    expect(screen.getAllByTestId('trend-empty')[0]).toHaveTextContent('No data yet over 24 h')
  })

  it('skeleton while the history loads, "History unavailable" on 404 or failure', () => {
    history = { history: null, loading: true, error: null }
    renderTab(propsOf({ range: '24h' }))
    expect(screen.getAllByTestId('trend-loading').length).toBeGreaterThanOrEqual(3)
    cleanup()

    history = { history: null, loading: false, error: null }
    renderTab(propsOf({ range: '7d' }))
    for (const el of screen.getAllByTestId('trend-unavailable')) expect(el).toHaveTextContent(en.cephCockpit.overview.trend.unavailable)
  })

  it('draws a stored period', () => {
    history = { history: { from: '', to: '', step: 300, points: [1000, 1300, 1600].map(t => ({ ...point(t), pgs_clean: 8 })), slowest_osds: [] }, loading: false, error: null }
    renderTab(propsOf({ range: '24h' }))

    expect(historyCalls.at(-1)).toEqual(['c1', '24h', true])
    expect(screen.getAllByTestId('perf-chart')).toHaveLength(3)
  })

  it('Enterprise Live asks the last hour of history once; Community Live does not', () => {
    renderTab(propsOf({ buffer: buffer(5) }))
    expect(lastHourCalls.at(-1)).toEqual(['c1', true])
    cleanup()
    lastHourCalls.length = 0

    renderTab(propsOf({ buffer: buffer(5), enterprise: false }))
    expect(lastHourCalls.at(-1)).toEqual(['c1', false])
    cleanup()
    lastHourCalls.length = 0

    renderTab(propsOf({ range: '24h' }))
    expect(lastHourCalls.at(-1)).toEqual(['c1', false])
  })

  it('Enterprise Live: the last hour fills the chart before the buffer has two points and the cards say so', () => {
    lastHour = { from: '', to: '', step: 60, points: [1_700_000_000, 1_700_000_060, 1_700_000_120].map(point), slowest_osds: [] }
    renderTab(propsOf({ buffer: buffer(1) }))

    expect(screen.queryByTestId('perf-live-waiting')).toBeNull()
    expect(within(screen.getByTestId('perf-iops')).getByTestId('perf-chart')).toBeInTheDocument()
    for (const id of ['perf-iops', 'perf-throughput', 'perf-recovery']) expect(within(screen.getByTestId(id)).getByText(en.cephCockpit.perf.live.captionHistory)).toBeInTheDocument()
  })

  it('Enterprise Live without history keeps the plain Live subtitle, as Community', () => {
    renderTab(propsOf({ buffer: buffer(5) }))
    expect(within(screen.getByTestId('perf-iops')).getByText(en.cephCockpit.range.live)).toBeInTheDocument()
    expect(screen.queryByText(en.cephCockpit.perf.live.captionHistory)).toBeNull()
    cleanup()

    lastHour = { from: '', to: '', step: 60, points: [1_700_000_000, 1_700_000_060].map(point), slowest_osds: [] }
    renderTab(propsOf({ buffer: buffer(5), enterprise: false }))
    expect(within(screen.getByTestId('perf-iops')).getByText(en.cephCockpit.range.live)).toBeInTheDocument()
    expect(screen.queryByText(en.cephCockpit.perf.live.captionHistory)).toBeNull()
  })

  it('the legend keys repeat the stroke of the curves: the write key carries the dash pattern of its line', () => {
    renderTab(propsOf({ buffer: buffer(5) }))

    const iops = within(screen.getByTestId('perf-iops'))
    const write = iops.getAllByTestId('series-key').find(e => e.getAttribute('data-series') === 'writeOps')?.querySelector('line')
    const read = iops.getAllByTestId('series-key').find(e => e.getAttribute('data-series') === 'readOps')?.querySelector('line')

    expect(write?.getAttribute('stroke-dasharray')).toBe('5 3')
    expect(write?.getAttribute('stroke-width')).toBe('1.5')
    expect(read?.getAttribute('stroke-dasharray')).toBeNull()
  })

  it('an empty last hour (no point) keeps the plain Live subtitle', () => {
    lastHour = { from: '', to: '', step: 60, points: [], slowest_osds: [] }
    renderTab(propsOf({ buffer: buffer(5) }))

    expect(within(screen.getByTestId('perf-iops')).getByText(en.cephCockpit.range.live)).toBeInTheDocument()
    expect(screen.queryByText(en.cephCockpit.perf.live.captionHistory)).toBeNull()
  })

  it('falls back to Live outside Enterprise', () => {
    renderTab(propsOf({ range: '7d', enterprise: false, buffer: buffer(3) }))

    expect(historyCalls.at(-1)).toEqual(['c1', 'live', false])
    expect(screen.getAllByTestId('perf-chart')).toHaveLength(3)
  })
})

describe('PerformanceTab honesty', () => {
  it('draws straight segments between measured points (linear), never an interpolated curve', () => {
    renderTab(propsOf({ buffer: buffer(5) }))

    expect(areaTypes.length).toBe(6)
    expect(new Set(areaTypes)).toEqual(new Set(['linear']))
  })

  it('shows "no recovery, every PG clean" instead of a chart scaled on nothing', () => {
    renderTab(propsOf({ buffer: buffer(5).map(l => ({ ...l, pg: { total: 10, clean: 10, byState: [] } })) }))

    expect(screen.getAllByTestId('perf-chart')).toHaveLength(2)
    expect(within(screen.getByTestId('perf-recovery')).queryByTestId('perf-chart')).toBeNull()
    expect(within(screen.getByTestId('perf-recovery')).getByTestId('perf-recovery-idle')).toHaveTextContent(en.cephCockpit.perf.recovery.idle)
    expect(within(screen.getByTestId('perf-recovery')).queryByText(en.cephCockpit.perf.series.unclean)).toBeNull()
  })

  it('draws the recovery chart as soon as one series is not zero', () => {
    renderTab(propsOf({ buffer: [...buffer(4).map(l => ({ ...l, pg: { total: 10, clean: 10, byState: [] } })), liveOf(1_700_000_030_000, { recovery: { bytesPerSec: 5, objectsPerSec: 0, degraded: 0, misplaced: 0 }, pg: { total: 10, clean: 10, byState: [] } })] }))
    expect(within(screen.getByTestId('perf-recovery')).getByTestId('perf-chart')).toBeInTheDocument()
    cleanup()
    renderTab(propsOf({ buffer: buffer(4) }))
    expect(within(screen.getByTestId('perf-recovery')).getByTestId('perf-chart')).toBeInTheDocument()
  })

  it('hides the legend when no curve is drawn (waiting, unavailable, empty)', () => {
    renderTab(propsOf({ buffer: buffer(1) }))
    expect(screen.queryByText(en.cephCockpit.perf.series.read)).toBeNull()
    cleanup()
    history = { history: null, loading: false, error: null }
    renderTab(propsOf({ range: '24h' }))
    expect(screen.queryByText(en.cephCockpit.perf.series.write)).toBeNull()
    cleanup()
    renderTab(propsOf({ buffer: buffer(4) }))
    expect(screen.getAllByText(en.cephCockpit.perf.series.read).length).toBeGreaterThan(0)
  })

  it('unavailable ranking is as high as the charts', () => {
    history = { history: null, loading: false, error: null }
    renderTab(propsOf({ range: '24h' }))

    const slot = within(screen.getByTestId('perf-slowest')).getByTestId('trend-unavailable')

    expect(slot).toHaveStyle({ height: '170px' })
  })
})

describe('slowest OSDs', () => {
  it('bars are absolute, anchored on the threshold: 1 ms is a sliver, with a mark at 10 ms', () => {
    renderTab(propsOf({ buffer: buffer(3), inventory: inventoryOf([osd(0, 1), osd(1, 5), osd(2, 2)]) }))

    const bars = screen.getAllByTestId('slowest-bar')

    expect(bars.map(b => b.getAttribute('data-width'))).toEqual(['25', '10', '5'])
    expect(screen.getAllByTestId('slowest-threshold')[0]).toHaveAttribute('data-at', '50')
  })

  it('bars grow with the slowest OSD above twice the threshold', () => {
    renderTab(propsOf({ buffer: buffer(3), inventory: inventoryOf([osd(0, 40), osd(1, 20)]) }))
    expect(screen.getAllByTestId('slowest-bar').map(b => b.getAttribute('data-width'))).toEqual(['100', '50'])
    expect(screen.getAllByTestId('slowest-threshold')[0]).toHaveAttribute('data-at', '25')
  })

  it('flags an OSD on the cluster baseline, not on the displayed rows: 500 OSDs at 2 ms, one at 25 ms', () => {
    const list = Array.from({ length: 500 }, (_, i) => osd(i, 2))

    list[3] = osd(3, 25)
    renderTab(propsOf({ buffer: buffer(3), inventory: inventoryOf(list) }))
    expect(screen.getAllByTestId('slowest-osd').filter(r => r.getAttribute('data-slow') === 'true').map(r => r.getAttribute('data-osd'))).toEqual(['3'])
  })

  it('does not flag on 10 ms alone nor on the ratio alone', () => {
    renderTab(propsOf({ buffer: buffer(3), inventory: inventoryOf([osd(0, 12), osd(1, 11), osd(2, 9), osd(3, 4), osd(4, 2), osd(5, 12)]) }))
    expect(screen.getAllByTestId('slowest-osd').filter(r => r.getAttribute('data-slow') === 'true')).toHaveLength(0)
  })

  it('over a period the baseline is the mean of the window', () => {
    history = {
      history: { from: '', to: '', step: 300, points: [point(1000), point(1300)], slowest_osds: [{ osd_id: 2, avg_ms: 12, max_ms: 30 }, { osd_id: 0, avg_ms: 7, max_ms: 20 }] },
      loading: false,
      error: null,
    }
    renderTab(propsOf({ range: '24h' }))

    const flags = Object.fromEntries(screen.getAllByTestId('slowest-osd').map(r => [r.getAttribute('data-osd'), r.getAttribute('data-slow')]))

    expect(flags).toEqual({ 2: 'true', 0: 'false' })
  })

  it('Live: ranks the inventory latencies, slowest first, flags the outlier', () => {
    renderTab(propsOf({ buffer: buffer(3), inventory: inventoryOf([osd(0, 2), osd(1, 23), osd(2, 3), osd(3, 4)]) }))

    const rows = screen.getAllByTestId('slowest-osd')

    expect(rows.map(r => r.getAttribute('data-osd'))).toEqual(['1', '3', '2', '0'])
    expect(rows[0]).toHaveAttribute('data-slow', 'true')
    expect(rows[1]).toHaveAttribute('data-slow', 'false')
    expect(rows[0]).toHaveTextContent('23 ms')
    expect(rows[0]).toHaveTextContent('hdd')
    expect(rows[0]).toHaveAccessibleName('Open OSD 1, slow')
    expect(within(rows[0]).getByTestId('slowest-flag')).toHaveAccessibleName('Slow')
    expect(rows[1]).toHaveAccessibleName('Open OSD 3')
    expect(within(rows[1]).queryByTestId('slowest-flag')).toBeNull()
  })

  it('caps the ranking at 8 and links to every OSD', () => {
    const props = renderTab(propsOf({ buffer: buffer(3), inventory: inventoryOf(Array.from({ length: 20 }, (_, i) => osd(i, i + 1))) }))

    expect(screen.getAllByTestId('slowest-osd')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'All (20)' }))
    expect(props.onNavigate).toHaveBeenCalledWith({ tab: 'osd' })
  })

  it('opens the OSD sheet on click', () => {
    const props = renderTab(propsOf({ buffer: buffer(3) }))

    fireEvent.click(screen.getByRole('button', { name: 'Open OSD 1' }))
    expect(props.onNavigate).toHaveBeenCalledWith({ tab: 'osd', item: { kind: 'osd', id: 1 } })
  })

  it('over a period takes the history ranking, with the inventory class and host', () => {
    history = {
      history: { from: '', to: '', step: 300, points: [point(1000), point(1300)], slowest_osds: [{ osd_id: 2, avg_ms: 7, max_ms: 30 }, { osd_id: 0, avg_ms: 12, max_ms: 20 }] },
      loading: false,
      error: null,
    }
    renderTab(propsOf({ range: '24h' }))

    const rows = screen.getAllByTestId('slowest-osd')

    expect(rows.map(r => r.getAttribute('data-osd'))).toEqual(['0', '2'])
    expect(within(screen.getByTestId('perf-slowest')).getByText(en.cephCockpit.perf.slowest.subtitlePeriod)).toBeInTheDocument()
    expect(screen.getByText('Cluster mean 4 ms', { exact: false })).toBeInTheDocument()
  })

  it('says so when no latency was read, and shows no row for an OSD without one', () => {
    const noReading = { ...osd(0, 0), commitLatencyMs: Number.NaN, applyLatencyMs: Number.NaN }

    renderTab(propsOf({ buffer: buffer(3), inventory: inventoryOf([noReading]) }))
    expect(screen.queryByTestId('slowest-osd')).toBeNull()
    expect(screen.getByTestId('slowest-empty')).toHaveTextContent(en.cephCockpit.perf.slowest.empty)
  })
})

describe('PerformanceTab value axes', () => {
  const big = (bytes: number) => Array.from({ length: 5 }, (_, i) => liveOf(1_700_000_000_000 + i * 5000, { io: { readOps: 94, writeOps: 11, readBytes: bytes, writeBytes: bytes / 2 } }))

  it('every value axis is as wide as its longest formatted tick (no label broken on two lines)', () => {
    renderTab(propsOf({ buffer: big(200 * 1024 * 0.95) }))

    expect(yAxes.length).toBeGreaterThanOrEqual(4)
    for (const axis of yAxes) {
      const labels = (axis.ticks ?? []).map(v => axis.tickFormatter?.(v) ?? String(v))

      expect(axis.width, labels.join('|')).toBeGreaterThanOrEqual(tickAxisWidth(labels, 0))
    }
    const throughput = yAxes.find(a => (a.ticks ?? []).map(v => a.tickFormatter?.(v) ?? '').some(l => l.includes('KiB/s')))

    expect(throughput?.width).toBeGreaterThanOrEqual('200 KiB/s'.length * 6)
  })

  it('MiB/s ticks widen the axis too', () => {
    renderTab(propsOf({ buffer: big(800 * 1024 * 1024) }))
    const axis = yAxes.find(a => (a.ticks ?? []).map(v => a.tickFormatter?.(v) ?? '').some(l => l.includes('MiB/s')))

    expect(axis?.width).toBeGreaterThanOrEqual('800 MiB/s'.length * 6)
  })
})

describe('PerfTooltip', () => {
  const series = [
    { key: 'readOps' as const, label: 'Read', color: '#00f', axis: 'left' as const, value: (v: number) => `${v} ops` },
    { key: 'writeOps' as const, label: 'Write', color: '#80f', axis: 'left' as const, value: (v: number) => `${v} ops` },
  ]

  it('lists every series at the pointed time, value first', () => {
    render(
      <ThemeProvider theme={theme}>
        <PerfTooltip active label={1000} payload={[{ dataKey: 'readOps', value: 94 }, { dataKey: 'writeOps', value: 11 }]} series={series} time={t => `t${t}`} />
      </ThemeProvider>,
    )

    const tip = screen.getByTestId('perf-tooltip')

    expect(tip).toHaveTextContent('t1000')
    expect(tip).toHaveTextContent('94 opsRead')
    expect(tip).toHaveTextContent('11 opsWrite')
  })

  it('draws the key of each series with the stroke of its curve: the write key is dashed, the read key solid', () => {
    const dashed = [
      { key: 'readOps' as const, label: 'Read', color: '#00f', axis: 'left' as const, value: (v: number) => `${v}` },
      { key: 'writeOps' as const, label: 'Write', color: '#80f', axis: 'left' as const, dashed: true, dash: '5 3', width: 1.5, value: (v: number) => `${v}` },
    ]

    render(
      <ThemeProvider theme={theme}>
        <PerfTooltip active label={1000} payload={[{ dataKey: 'readOps', value: 94 }, { dataKey: 'writeOps', value: 11 }]} series={dashed} time={String} />
      </ThemeProvider>,
    )

    const lineOf = (key: string) => document.querySelector(`[data-testid="series-key"][data-series="${key}"] line`)

    expect(lineOf('writeOps')?.getAttribute('stroke-dasharray')).toBe('5 3')
    expect(lineOf('writeOps')?.getAttribute('stroke-width')).toBe('1.5')
    expect(lineOf('readOps')?.getAttribute('stroke-dasharray')).toBeNull()
  })

  it('draws nothing on a collection gap (null values)', () => {
    const { container } = render(
      <ThemeProvider theme={theme}>
        <PerfTooltip active label={1000} payload={[{ dataKey: 'readOps', value: null }]} series={series} time={String} />
      </ThemeProvider>,
    )

    expect(container).toBeEmptyDOMElement()
  })
})

describe('PerformanceTab colours follow the theme', () => {
  const rgb = (color: string) => {
    const el = document.createElement('span')

    el.style.color = color

    return el.style.color
  }

  it('draws read, write and recovery with toneColor of the current theme, not with fixed colours', () => {
    const violet = createTheme({ palette: { mode: 'light', primary: { main: '#7C3AED' } } })

    render(
      <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
        <ThemeProvider theme={violet}>
          <PerformanceTab {...propsOf({ buffer: buffer(5) })} />
        </ThemeProvider>
      </NextIntlClientProvider>,
    )

    const keys = Array.from(document.querySelectorAll('[data-testid="series-key"] line')).map(e => e.getAttribute('stroke'))

    for (const tone of ['read', 'write', 'recovery'] as const) expect(keys).toContain(toneColor(violet, tone))
    expect(keys).toContain(uncleanColor(violet))
    expect(keys).not.toContain('#8B5CF6')
  })
})
