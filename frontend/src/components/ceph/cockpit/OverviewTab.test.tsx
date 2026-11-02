import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import en from '@/messages/en.json'
import type { CephHistory } from '@/lib/orchestrator/client'
import type { CephInventory, CephLive, CephRange } from '@/lib/ceph/types'

import { osdCell } from '@/lib/ceph/hostMap'

import type { CockpitFocus, CockpitTabProps } from './CephCockpit'
import OverviewTab from './OverviewTab'
import { FILL_COLUMN, lgStyle } from './fillTestUtils'

let history: { history: CephHistory | null; loading: boolean; error: Error | null } = { history: null, loading: false, error: null }
const historyCalls: unknown[][] = []

vi.mock('./hooks/useCephHistory', () => ({
  useCephHistory: (...args: unknown[]) => {
    historyCalls.push(args)

    return history
  },
}))
// osdCell runs once per render of a dense square (and of a card row): it counts the renders.
vi.mock('@/lib/ceph/hostMap', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ceph/hostMap')>()

  return { ...actual, osdCell: vi.fn(actual.osdCell) }
})
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }))

const theme = createTheme()
const GiB = 1024 ** 3

const liveOf = (over: Partial<CephLive> = {}): CephLive => ({
  health: { status: 'HEALTH_OK', checks: [] },
  pg: { total: 129, clean: 128, byState: [{ state: 'active+clean', count: 128 }, { state: 'active+clean+inconsistent', count: 1 }] },
  osd: { total: 3, up: 3, in: 3 },
  io: { readOps: 94, writeOps: 11, readBytes: 107 * 1024, writeBytes: 73 * 1024 },
  recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 0 },
  raw: { used: 245.4 * GiB, total: 300 * GiB },
  at: 1,
  ...over,
})

const osd = (id: number, host: string, usedPct: number) => ({
  id, name: `osd.${id}`, host, status: 'up', up: true, in: true, deviceClass: 'hdd', totalBytes: 0, usedBytes: 0, availBytes: 0,
  usedPct, commitLatencyMs: Number(id) + 1, applyLatencyMs: Number(id) + 1, pgs: 129, version: '20.2.4',
})

const pool = (name: string, percentUsed: number, pgNum = 128) => ({
  id: 1, name, size: 3, minSize: 2, pgNum, pgNumTarget: pgNum, type: 'replicated', application: 'rbd', crushRule: 0, crushRuleName: 'replicated_rule',
  crushRootId: -1, pgAutoscaleMode: 'on', bytesUsed: 0, maxAvail: 0, objects: 0, bytesUsedFormatted: '', maxAvailFormatted: '', percentUsed,
})

const INVENTORY = {
  hasCeph: true,
  health: { status: 'HEALTH_OK', checks: [], numChecks: 0 },
  capacity: { rawUsedBytes: 245.4 * GiB, rawTotalBytes: 300 * GiB },
  performance: { readOpsSec: 1, writeOpsSec: 1, readBytesSec: 1, writeBytesSec: 1 },
  pgs: { total: 129, states: [{ state_name: 'active+clean', count: 129 }] },
  osds: { total: 3, up: 3, in: 3, down: 0, out: 0, list: [osd(0, 'pve1', 81.8), osd(1, 'pve2', 81.9), osd(2, 'pve3', 81.8)] },
  monitors: { total: 0, inQuorum: 0, quorumNames: [], list: [] },
  managers: { active: null, standbys: [] },
  mds: { total: 0, list: [] },
  pools: { total: 2, list: [pool('.mgr', 0.0001, 1), pool('ceph-vm', 0.86)] },
} as unknown as CephInventory

type Props = CockpitTabProps

function propsOf(over: { live?: CephLive | null; buffer?: CephLive[]; range?: CephRange; enterprise?: boolean; inventory?: CephInventory | null; focus?: CockpitFocus | null } = {}): Props {
  const live = over.live === undefined ? liveOf() : over.live

  return {
    conn: 'c1',
    live: { live, buffer: over.buffer ?? [], error: null, lastOkAt: 1, absent: false, stale: false, refresh: vi.fn() },
    inventory: { inventory: over.inventory === undefined ? INVENTORY : over.inventory, absent: false, error: null, lastOkAt: 1, stale: false, reload: vi.fn() },
    url: { conn: 'c1', tab: 'overview', item: null, filter: 'all', range: over.range ?? 'live', hosts: 'all', map: null, set: vi.fn() },
    enterprise: over.enterprise ?? true,
    ratios: { nearfull: 0.85, full: 0.95 },
    focus: over.focus ?? null,
    osdFlags: { flags: [], hostFlags: {}, osdFlags: {}, loading: false, toggling: null, forbidden: false, toggle: vi.fn(), toggleHost: vi.fn() } as unknown as Props['osdFlags'],
    latencyBuffer: {},
    onNavigate: vi.fn(),
  }
}

function renderTab(props: Props) {
  const view = render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={theme}>
        <OverviewTab {...props} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )

  return { ...view, props }
}

const tile = (label: string) => screen.getByTestId(`tile-${label}`)

beforeEach(() => {
  history = { history: null, loading: false, error: null }
  historyCalls.length = 0
})

afterEach(cleanup)

describe('OverviewTab', () => {
  it('below lg: the OverviewTab has no fill style, natural flow', () => {
    renderTab(propsOf())

    const root = screen.getByTestId('overview-tab')

    expect(root).not.toHaveStyle({ flexGrow: '1' })
    expect(root).not.toHaveStyle({ minHeight: '0px' })
  })

  it('wide: the host map takes the height left under the banner and the tiles, which keep theirs', () => {
    renderTab(propsOf({ live: liveOf({ recovery: { bytesPerSec: 1024, objectsPerSec: 0, degraded: 0, misplaced: 0 } }) }))

    expect(lgStyle(screen.getByTestId('overview-tab'))).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('host-map').parentElement as HTMLElement)).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('host-map'))).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('tile-raw'))).not.toHaveProperty('flex')
    expect(lgStyle(screen.getByTestId('recovery-banner'))).not.toHaveProperty('flex')
  })

  it('has no Pools nor PG block any more: they live in their own tabs', () => {
    renderTab(propsOf())

    expect(screen.queryByTestId('overview-lower')).toBeNull()
    expect(screen.queryByTestId('overview-pool')).toBeNull()
    expect(screen.queryByTestId('pg-card')).toBeNull()
    expect(screen.queryByText('Placement groups')).toBeNull()
    expect(screen.queryByText('Net fill against the cluster thresholds')).toBeNull()
    expect(screen.getByTestId('host-map')).toBeInTheDocument()
  })

  it('recovery banner hidden at zero', () => {
    renderTab(propsOf())

    expect(screen.queryByTestId('recovery-banner')).toBeNull()
  })

  it('shows the recovery banner with its rate and the degraded objects', () => {
    renderTab(propsOf({ live: liveOf({ recovery: { bytesPerSec: 48 * 1024 ** 2, objectsPerSec: 12, degraded: 1234, misplaced: 56 } }) }))

    const banner = screen.getByTestId('recovery-banner')

    expect(banner).toHaveTextContent(en.cephCockpit.overview.recovery.title)
    expect(banner).toHaveTextContent('48 MiB/s')
    expect(banner).toHaveTextContent('1,234 degraded objects')
    expect(banner).toHaveTextContent('56 misplaced objects')
  })

  it('says degraded objects wait when nothing is being rebuilt yet', () => {
    renderTab(propsOf({ live: liveOf({ recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 10, misplaced: 0 } }) }))

    expect(screen.getByTestId('recovery-banner')).toHaveTextContent(en.cephCockpit.overview.recovery.waiting)
  })

  it('tiles show no sparkline in live with empty buffer', () => {
    renderTab(propsOf({ buffer: [] }))

    expect(screen.queryAllByTestId('sparkline')).toHaveLength(0)
    expect(tile('iops')).toHaveTextContent('105')
    expect(tile('throughput')).toHaveTextContent('180')
    expect(tile('throughput')).toHaveTextContent('KiB/s')
  })

  it('draws IOPS and throughput from the Live buffer, never the latency', () => {
    renderTab(propsOf({ buffer: [liveOf(), liveOf(), liveOf()] }))

    expect(within(tile('iops')).getByTestId('sparkline')).toBeInTheDocument()
    expect(within(tile('throughput')).getByTestId('sparkline')).toBeInTheDocument()
    expect(within(tile('latency')).queryByTestId('sparkline')).toBeNull()
    expect(within(tile('iops')).getByTestId('sparkline').querySelectorAll('polyline')).toHaveLength(2)
  })

  it('draws the stored period, latency included, and gives the capacity trend', () => {
    const point = (used: number, lat: number) => ({
      time: 1, health: 0 as const, read_ops: 5, write_ops: 1, read_bytes: 10, write_bytes: 20, recovering_bytes: 0, degraded_objects: 0,
      misplaced_objects: 0, pgs_total: 1, pgs_clean: 1, raw_used_bytes: used, raw_total_bytes: 1000, osd_total: 3, osd_up: 3, osd_in: 3,
      osd_lat_avg_ms: lat, osd_lat_max_ms: lat,
    })

    history = { history: { from: '', to: '', step: 300, points: [point(800, 1), point(812, 2)], slowest_osds: [] }, loading: false, error: null }
    renderTab(propsOf({ range: '24h', buffer: [] }))

    expect(historyCalls.at(-1)).toEqual(['c1', '24h', true])
    expect(within(tile('latency')).getByTestId('sparkline')).toBeInTheDocument()
    expect(tile('raw')).toHaveTextContent('+1.2 pt over 24 h')
  })

  it('asks no history outside Enterprise', () => {
    renderTab(propsOf({ range: '24h', enterprise: false }))

    expect(historyCalls.at(-1)).toEqual(['c1', 'live', false])
  })

  it('gives the raw capacity with its thresholds and the OSD latency from the inventory', () => {
    renderTab(propsOf())

    expect(tile('raw')).toHaveTextContent('81.8')
    expect(within(tile('raw')).getAllByTestId('threshold-marker')).toHaveLength(2)
    expect(tile('latency')).toHaveTextContent('2')
    expect(tile('latency')).toHaveTextContent('max 3 ms on osd.2')
  })

  it('opens the OSD sheet from the host map', () => {
    const { props } = renderTab(propsOf())

    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.overview.hostMap.open.replace('{id}', '2') }))
    expect(props.onNavigate).toHaveBeenCalledWith({ tab: 'osd', item: { kind: 'osd', id: 2 } })
  })

  it('has no status sentence: the health rail already says it', () => {
    renderTab(propsOf({ live: liveOf({ health: { status: 'HEALTH_WARN', checks: [{ name: 'OSD_DOWN', severity: 'HEALTH_WARN', summary: '1 osds down', detail: [] }] } }) }))

    expect(screen.queryByTestId('status-sentence')).toBeNull()
  })

  it('scrolls to the host map on focus=flags and lights it up', () => {
    const scroll = vi.fn()

    Element.prototype.scrollIntoView = scroll

    renderTab(propsOf({ focus: { kind: 'flags', nonce: 1 } }))

    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('ceph-overview-hosts'))
    expect(document.getElementById('ceph-overview-hosts')).toHaveAttribute('data-focused', 'true')
  })

  it('waits on the inventory without breaking the Live figures', () => {
    renderTab(propsOf({ inventory: null }))

    expect(tile('iops')).toHaveTextContent('105')
    expect(screen.getByTestId('host-map-loading')).toBeInTheDocument()
    expect(tile('latency')).toHaveTextContent(en.cephCockpit.ui.noData)
  })

  it('leads to the CRUSH map', () => {
    const { props } = renderTab(propsOf())

    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.overview.hostMap.crush }))
    expect(props.onNavigate).toHaveBeenCalledWith({ tab: 'crush' })
  })

  it('opens the Performance tab from the recovery banner', () => {
    const { props } = renderTab(propsOf({ live: liveOf({ recovery: { bytesPerSec: 1024, objectsPerSec: 0, degraded: 0, misplaced: 0 } }) }))

    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.overview.recovery.showPerf }))
    expect(props.onNavigate).toHaveBeenCalledWith({ tab: 'perf' })
  })

  describe('over a stored period', () => {
    const point = (lat: number | null) => ({
      time: 1, health: 0 as const, read_ops: 5, write_ops: 1, read_bytes: 10, write_bytes: 20, recovering_bytes: 0, degraded_objects: 0,
      misplaced_objects: 0, pgs_total: 1, pgs_clean: 1, raw_used_bytes: 500, raw_total_bytes: 1000, osd_total: 3, osd_up: 3, osd_in: 3,
      osd_lat_avg_ms: lat, osd_lat_max_ms: lat,
    })
    const curveZones = () => ['raw', 'iops', 'throughput', 'latency'].map(id => tile(id))

    it('shows a skeleton in each curve zone while the history loads', () => {
      history = { history: null, loading: true, error: null }
      renderTab(propsOf({ range: '24h', buffer: [liveOf(), liveOf()] }))

      for (const el of curveZones()) expect(within(el).getByTestId('trend-loading')).toBeInTheDocument()
      // The Live buffer is not drawn in its place.
      expect(screen.queryAllByTestId('sparkline')).toHaveLength(0)
    })

    it('says the history is unavailable when the orchestrator has none (404)', () => {
      history = { history: null, loading: false, error: null }
      renderTab(propsOf({ range: '7d' }))

      for (const el of curveZones()) expect(within(el).getByTestId('trend-unavailable')).toHaveTextContent(en.cephCockpit.overview.trend.unavailable)
    })

    it('says the history is unavailable when it fails', () => {
      history = { history: null, loading: false, error: new Error('API error: 502') }
      renderTab(propsOf({ range: '1h' }))

      expect(within(tile('iops')).getByTestId('trend-unavailable')).toBeInTheDocument()
      expect(within(tile('latency')).getByTestId('trend-unavailable')).toBeInTheDocument()
    })

    it('says there is no data yet over the period under 2 points', () => {
      history = { history: { from: '', to: '', step: 300, points: [point(1)], slowest_osds: [] }, loading: false, error: null }
      renderTab(propsOf({ range: '24h' }))

      for (const el of curveZones()) expect(within(el).getByTestId('trend-empty')).toHaveTextContent('No data yet over 24 h')
    })

    it('says the same for the latency alone when its buckets have no reading', () => {
      history = { history: { from: '', to: '', step: 300, points: [point(null), point(null), point(2)], slowest_osds: [] }, loading: false, error: null }
      renderTab(propsOf({ range: '24h' }))

      expect(within(tile('iops')).getByTestId('sparkline')).toBeInTheDocument()
      expect(within(tile('latency')).getByTestId('trend-empty')).toBeInTheDocument()
    })
  })

  // I2: a Live tick rebuilds live, its checks and the ratios object with the same content.
  it('renders no dense square again on a Live tick that changes nothing', () => {
    const list = Array.from({ length: 10 }, (_, i) => osd(i, i < 5 ? 'pve1' : 'pve2', 60))
    const dense = { ...INVENTORY, osds: { ...INVENTORY.osds, list } } as unknown as CephInventory
    const checks = [{ name: 'OSD_NEARFULL', severity: 'HEALTH_WARN', summary: '1 nearfull osd(s)', detail: [{ message: 'osd.3 is near full' }] }]
    const props = propsOf({ inventory: dense, live: liveOf({ health: { status: 'HEALTH_WARN', checks } }) })
    const tree = (p: Props) => (
      <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
        <ThemeProvider theme={theme}>
          <OverviewTab {...p} />
        </ThemeProvider>
      </NextIntlClientProvider>
    )
    const { rerender } = render(tree(props))

    expect(screen.getAllByTestId('osd-cell')).toHaveLength(10)
    vi.mocked(osdCell).mockClear()

    const tick = liveOf({ health: { status: 'HEALTH_WARN', checks: checks.map(c => ({ ...c, detail: c.detail.map(d => ({ ...d })) })) }, at: 2 })

    rerender(tree({ ...props, live: { ...props.live, live: tick, buffer: [tick] }, ratios: { ...props.ratios } }))
    expect(osdCell).not.toHaveBeenCalled()

    // A check that changes does reach the squares.
    const worse = liveOf({ health: { status: 'HEALTH_ERR', checks: [{ ...checks[0], severity: 'HEALTH_ERR' }] }, at: 3 })

    rerender(tree({ ...props, live: { ...props.live, live: worse, buffer: [tick, worse] } }))
    expect(osdCell).toHaveBeenCalled()
  })

  it('host map view: the URL choice forces the mode and a click on a segment writes map= and remembers it', () => {
    window.localStorage.clear()
    const props = propsOf()

    props.url = { ...props.url, map: 'dense' } as Props['url']
    renderTab(props)
    expect(screen.getByTestId('host-map')).toHaveAttribute('data-mode', 'dense')
    fireEvent.click(screen.getByTestId('host-map-view-compact'))
    expect(props.url.set).toHaveBeenCalledWith({ map: 'compact' })
    expect(window.localStorage.getItem('ceph-cockpit-host-map')).toBe('compact')
    window.localStorage.clear()
  })
})
