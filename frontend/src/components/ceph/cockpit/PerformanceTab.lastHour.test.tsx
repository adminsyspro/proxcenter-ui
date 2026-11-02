import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import en from '@/messages/en.json'
import type { CephInventory, CephLive } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import PerformanceTab from './PerformanceTab'
import { jsonRes, swrWrapper } from './hooks/testUtils'

/*
   The real history hooks, a stubbed network: counts the calls of the Performance tab in Live
   (Enterprise reads the last hour once, Community never, a hidden tab never).
*/

const fetchMock = vi.fn()
let tabVisible = true

vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => tabVisible }))
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>()
  const Passive = () => null

  return {
    ...actual,
    Area: Passive,
    AreaChart: ({ children }: { children: React.ReactNode }) => <svg>{children}</svg>,
    XAxis: Passive,
    YAxis: Passive,
    CartesianGrid: Passive,
    Tooltip: Passive,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div style={{ width: 600, height: 170 }}>{children}</div>,
  }
})

const theme = createTheme()

const liveOf = (at: number): CephLive => ({
  health: { status: 'HEALTH_OK', checks: [] },
  pg: { total: 10, clean: 10, byState: [] },
  osd: { total: 3, up: 3, in: 3 },
  io: { readOps: 94, writeOps: 11, readBytes: 1000, writeBytes: 500 },
  recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 0 },
  raw: { used: 1, total: 2 },
  at,
})

const hist = (time: number) => ({
  time, health: 0, read_ops: 10, write_ops: 5, read_bytes: 1000, write_bytes: 500, recovering_bytes: 0,
  degraded_objects: 0, misplaced_objects: 0, pgs_total: 10, pgs_clean: 10, raw_used_bytes: 1, raw_total_bytes: 2,
  osd_total: 3, osd_up: 3, osd_in: 3, osd_lat_avg_ms: 4, osd_lat_max_ms: 9,
})

function propsOf(enterprise: boolean, range: CockpitTabProps['url']['range'] = 'live'): CockpitTabProps {
  return {
    conn: 'c1',
    live: { live: null, buffer: [liveOf(1_700_000_000_000)], error: null, lastOkAt: 1, absent: false, stale: false, refresh: vi.fn() },
    inventory: { inventory: { hasCeph: true, osds: { total: 0, list: [] } } as unknown as CephInventory, absent: false, error: null, lastOkAt: 1, stale: false, reload: vi.fn() },
    url: { conn: 'c1', tab: 'perf', item: null, filter: 'all', range, hosts: 'all', map: null, set: vi.fn() },
    enterprise,
    ratios: { nearfull: 0.85, full: 0.95 },
    focus: null,
    osdFlags: {} as CockpitTabProps['osdFlags'],
    latencyBuffer: {},
    onNavigate: vi.fn(),
  }
}

const tree = (props: CockpitTabProps) => {
  const Wrapper = swrWrapper

  return (
    <Wrapper>
      <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
        <ThemeProvider theme={theme}>
          <PerformanceTab {...props} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </Wrapper>
  )
}

function renderTab(props: CockpitTabProps) {
  const out = render(tree(props))

  return { ...out, rerenderTab: (next: CockpitTabProps) => out.rerender(tree(next)) }
}

const historyCalls = () => fetchMock.mock.calls.filter(c => String(c[0]).includes('/history'))

beforeEach(() => {
  tabVisible = true
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonRes({ from: '', to: '', step: 60, points: [1_699_999_880, 1_699_999_940].map(hist), slowest_osds: [] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PerformanceTab, last hour in Live', () => {
  it('Enterprise Live reads the 1 h history once and draws it with a single Live point', async () => {
    renderTab(propsOf(true))

    await waitFor(() => expect(screen.getAllByText(en.cephCockpit.perf.live.captionHistory).length).toBeGreaterThan(0))
    await new Promise(r => setTimeout(r, 30))
    expect(historyCalls()).toHaveLength(1)
    expect(String(historyCalls()[0][0])).toBe('/api/v1/orchestrator/ceph/c1/history?range=1h')
    expect(screen.queryByTestId('perf-live-waiting')).toBeNull()
  })

  it('Community Live never reads the history', async () => {
    renderTab(propsOf(false))
    await new Promise(r => setTimeout(r, 30))

    expect(historyCalls()).toHaveLength(0)
    expect(screen.getAllByTestId('perf-live-waiting').length).toBeGreaterThan(0)
    expect(screen.queryByText(en.cephCockpit.perf.live.captionHistory)).toBeNull()
  })

  it('a stored period asks its own range only, not the last hour in addition', async () => {
    renderTab(propsOf(true, '24h'))
    await waitFor(() => expect(historyCalls()).toHaveLength(1))
    await new Promise(r => setTimeout(r, 30))

    expect(String(historyCalls()[0][0])).toBe('/api/v1/orchestrator/ceph/c1/history?range=24h')
    expect(historyCalls()).toHaveLength(1)
  })
})

describe('PerformanceTab, hidden tab', () => {
  it('a tab mounted hidden asks nothing more over ten minutes (no minute timer while hidden)', async () => {
    vi.useFakeTimers()
    try {
      tabVisible = false
      renderTab(propsOf(true))
      await vi.advanceTimersByTimeAsync(0)
      const afterMount = historyCalls().length

      await vi.advanceTimersByTimeAsync(600_000)
      expect(historyCalls()).toHaveLength(afterMount)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a visible tab rereads the last hour every minute', async () => {
    vi.useFakeTimers()
    try {
      renderTab(propsOf(true))
      await vi.advanceTimersByTimeAsync(0)
      expect(historyCalls()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(61_000)
      expect(historyCalls()).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PerformanceTab, license downgrade while open', () => {
  it('Enterprise to Community: no further history call, the subtitle goes back to Live', async () => {
    const { rerenderTab } = renderTab(propsOf(true))

    await waitFor(() => expect(screen.getAllByText(en.cephCockpit.perf.live.captionHistory).length).toBeGreaterThan(0))
    const before = historyCalls().length

    rerenderTab(propsOf(false))
    await new Promise(r => setTimeout(r, 50))

    expect(historyCalls()).toHaveLength(before)
    expect(screen.queryByText(en.cephCockpit.perf.live.captionHistory)).toBeNull()
    expect(within(screen.getByTestId('perf-iops')).getByText(en.cephCockpit.range.live)).toBeInTheDocument()
  })
})
