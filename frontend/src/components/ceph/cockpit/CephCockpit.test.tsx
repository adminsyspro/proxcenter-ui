import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import en from '@/messages/en.json'
import type { CephLive } from '@/lib/ceph/types'

import CephCockpit, { TAB_ICONS_MIN_BAR_PX, TAB_ICONS_WHEN_NARROW, TAB_PANELS, TABBAR_CONTAINER } from './CephCockpit'
import { FILL_COLUMN, lgStyle } from './fillTestUtils'

const push = vi.fn()
const replace = vi.fn()
let search = ''
let license = { enterprise: true, resolved: true }
let health: Record<string, { status: string | null; error: boolean; absent: boolean }> = {}

const liveOf = (over: Partial<CephLive> = {}): CephLive => ({
  health: { status: 'HEALTH_OK', checks: [] },
  pg: { total: 129, clean: 129, byState: [{ state: 'active+clean', count: 129 }] },
  osd: { total: 3, up: 3, in: 3 },
  io: { readOps: 94, writeOps: 11, readBytes: 1000, writeBytes: 500 },
  recovery: { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 0 },
  raw: { used: 10, total: 100 },
  at: 1,
  ...over,
})

type LiveHook = { live: CephLive | null; buffer: CephLive[]; error: Error | null; lastOkAt: number | null; absent: boolean; stale: boolean; refresh: () => void }
let liveState: LiveHook
let inventoryState: { inventory: unknown; error: Error | null; lastOkAt: number | null; absent: boolean; stale: boolean; reload: () => void }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/storage/ceph',
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('./hooks/useCockpitLicense', () => ({ useCockpitLicense: () => license }))
const refreshDots = vi.fn()
const refreshHistory = vi.fn()

vi.mock('./hooks/useClusterHealthList', () => ({ useClusterHealthList: () => health, useRefreshClusterHealthList: () => refreshDots }))
vi.mock('./hooks/useCephLive', () => ({ useCephLive: () => liveState }))
vi.mock('./hooks/useCephInventory', () => ({ useCephInventory: () => inventoryState }))
vi.mock('./hooks/useCephHistory', () => ({ useCephHistory: () => ({ history: null, loading: false, error: null }), useCephLastHour: () => ({ history: null, loading: false, error: null }), useRefreshCephHistory: () => refreshHistory }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }))
vi.mock('@/components/ceph/CephOsdFlags', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/ceph/CephOsdFlags')>()),
  useCephOsdFlags: () => ({
    flags: [], hostFlags: {}, osdFlags: {}, loading: false, toggling: null, forbidden: false, toggle: vi.fn(), toggleHost: vi.fn(),
  }),
}))

const theme = createTheme()
const CONNS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }]

function cockpitTree(connections = CONNS) {
  return (
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={theme}>
        <CephCockpit connections={connections} />
      </ThemeProvider>
    </NextIntlClientProvider>
  )
}

function renderCockpit(connections = CONNS) {
  return render(cockpitTree(connections))
}

beforeEach(() => {
  push.mockReset()
  replace.mockReset()
  search = 'conn=c1'
  license = { enterprise: true, resolved: true }
  health = { c1: { status: 'HEALTH_OK', error: false, absent: false }, c2: { status: 'HEALTH_OK', error: false, absent: false } }
  refreshDots.mockReset()
  refreshHistory.mockReset()
  liveState = { live: liveOf(), buffer: [], error: null, lastOkAt: Date.now(), absent: false, stale: false, refresh: vi.fn() }
  inventoryState = { inventory: null, error: null, lastOkAt: null, absent: false, stale: false, reload: vi.fn() }
})

afterEach(cleanup)

describe('CephCockpit', () => {
  it('below lg: no fill style anywhere in the chain, natural flow', () => {
    renderCockpit()

    for (const id of ['cockpit-root', 'cockpit-main', 'cockpit-panel']) {
      const el = screen.getByTestId(id)

      expect(el).not.toHaveStyle({ display: 'flex' })
      expect(el).not.toHaveStyle({ flexGrow: '1' })
      expect(el).not.toHaveStyle({ minHeight: '0px' })
    }
  })

  it('wide: every node from the root to the active tab grows into the free height, the rail slot takes the row height without adding any', () => {
    renderCockpit()

    expect(lgStyle(screen.getByTestId('cockpit-root'))).toMatchObject({ ...FILL_COLUMN, 'flex-grow': '1', 'flex-shrink': '0' })
    expect(screen.getByTestId('cockpit-body')).toHaveStyle({ flex: '1 1 auto', minHeight: '0px', alignItems: 'stretch' })
    expect(lgStyle(screen.getByTestId('cockpit-main'))).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('cockpit-panel'))).toMatchObject(FILL_COLUMN)
    expect(screen.getByTestId('rail-slot')).toHaveStyle({ position: 'relative', minHeight: '360px' })
    expect(screen.getByTestId('rail-fill')).toHaveStyle({ position: 'absolute', display: 'flex', flexDirection: 'column' })
    expect(screen.getByTestId('health-rail')).toHaveStyle({ height: '100%' })
  })

  it('renders empty state when hasCeph false', () => {
    health = { c1: { status: null, error: false, absent: true }, c2: { status: null, error: false, absent: true } }
    renderCockpit()

    expect(screen.getByText(en.cephCockpit.empty.title)).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('renders the empty state without any connection', () => {
    renderCockpit([])

    expect(screen.getByText(en.cephCockpit.empty.title)).toBeInTheDocument()
  })

  it('rebuilds MON_DISK_* in the rail from the free space of every mon, whichever one Ceph cites', () => {
    const cites = { name: 'MON_DISK_LOW', severity: 'HEALTH_WARN', summary: 'mon pve2-dr is low on available space', detail: [{ message: 'mon.pve2-dr has 14% avail' }] }
    const disk = (mon: string, availPct: number) => ({ mon, node: mon, availBytes: availPct, totalBytes: 100, availPct })

    search = 'conn=c1&tab=crush'
    liveState = { ...liveState, live: liveOf({ health: { status: 'HEALTH_WARN', checks: [cites] } }) }
    inventoryState = { ...inventoryState, inventory: { monDisk: [disk('pve1-dr', 3.4), disk('pve2-dr', 14.2), disk('pve3-dr', 17.9)], osds: { list: [], down: 0 }, pools: { total: 0 }, monitors: { total: 3 }, managers: { active: null, standbys: [] }, mds: { total: 0 }, health: { status: 'HEALTH_OK', checks: [], numChecks: 0 } } as never }
    renderCockpit()

    expect(screen.getAllByTestId('rail-check').map(c => c.getAttribute('data-code'))).toEqual(['MON_DISK_CRIT', 'MON_DISK_LOW'])
    expect(screen.getByTestId('rail-state')).toHaveTextContent(en.cephCockpit.health.HEALTH_ERR)
  })

  it('rail groups errors before warnings and links to target', () => {
    liveState = {
      ...liveState,
      live: liveOf({
        health: {
          status: 'HEALTH_ERR',
          checks: [
            { name: 'OSD_DOWN', severity: 'HEALTH_WARN', summary: '1 osds down', detail: [{ message: 'osd.2 (root=default,host=pve3) is down' }] },
            { name: 'OSD_SCRUB_ERRORS', severity: 'HEALTH_ERR', summary: '2 scrub errors', detail: [] },
          ],
        },
      }),
    }
    renderCockpit()

    const checks = screen.getAllByTestId('rail-check')

    expect(checks.map(c => c.getAttribute('data-code'))).toEqual(['OSD_SCRUB_ERRORS', 'OSD_DOWN'])
    fireEvent.click(within(checks[1]).getByTestId('rail-link'))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toContain('tab=osd&filter=down')
  })

  it('community range selector only offers Live', () => {
    license = { enterprise: false, resolved: true }
    renderCockpit()

    const group = screen.getByRole('group', { name: en.cephCockpit.header.range })

    expect(within(group).getAllByRole('button').map(b => b.textContent)).toEqual([en.cephCockpit.range.live])
    expect(screen.queryByText(/enterprise/i)).toBeNull()
  })

  it('offers every period in Enterprise and writes the choice to the URL', () => {
    renderCockpit()

    const group = screen.getByRole('group', { name: en.cephCockpit.header.range })

    expect(within(group).getAllByRole('button')).toHaveLength(5)
    fireEvent.click(within(group).getByRole('button', { name: en.cephCockpit.range['24h'] }))
    expect(replace).toHaveBeenCalledWith('/storage/ceph?conn=c1&range=24h')
  })

  it('stale shows last read banner and keeps data', () => {
    liveState = {
      ...liveState,
      live: liveOf({ health: { status: 'HEALTH_WARN', checks: [{ name: 'MON_DOWN', severity: 'HEALTH_WARN', summary: '1/3 mons down', detail: [] }] } }),
      error: new Error('API error: 502'),
      lastOkAt: Date.now() - 42_000,
      stale: true,
    }
    renderCockpit()

    expect(screen.getByTestId('cockpit-stale')).toHaveTextContent(en.cephCockpit.stale.title)
    expect(screen.getByTestId('cockpit-stale')).toHaveTextContent('42 s')
    expect(screen.getByTestId('rail-check')).toHaveAttribute('data-code', 'MON_DOWN')
    expect(screen.getByTestId('cockpit-body')).toHaveAttribute('data-stale', 'true')
  })

  it('an inventory that alone fails is a quiet note in the header, nothing greyed', () => {
    inventoryState = { ...inventoryState, error: new Error('API error: 500'), stale: true, lastOkAt: Date.now() - 180_000 }
    renderCockpit()

    expect(screen.queryByTestId('cockpit-stale')).toBeNull()
    expect(screen.getByTestId('cockpit-body')).toHaveAttribute('data-stale', 'false')
    expect(screen.getByTestId('inventory-stale')).toHaveTextContent('Inventory not refreshed for 3 min')
  })

  it('refresh re-reads the Live, the inventory and the cluster dots', () => {
    renderCockpit()

    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.header.refresh }))
    expect(liveState.refresh).toHaveBeenCalledTimes(1)
    expect(inventoryState.reload).toHaveBeenCalledTimes(1)
    expect(refreshHistory).toHaveBeenCalledTimes(1)
    expect(refreshDots).toHaveBeenCalledTimes(1)
  })

  it('lists the clusters that have Ceph only, with their health dot', () => {
    health = { c1: { status: 'HEALTH_ERR', error: false, absent: false }, c2: { status: null, error: false, absent: true } }
    renderCockpit()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: en.cephCockpit.header.cluster }))
    const options = screen.getAllByRole('option')

    expect(options.map(o => o.textContent)).toEqual(['PVE-PROD'])
  })

  it('puts the controls on the tab bar line, the cluster picker last', () => {
    renderCockpit()
    const bar = screen.getByTestId('cockpit-tabbar')
    const picker = within(bar).getByRole('combobox', { name: en.cephCockpit.header.cluster })

    expect(within(bar).getAllByRole('tab')).toHaveLength(6)
    expect(within(bar).getByTestId('cockpit-header')).toContainElement(picker)
    expect(picker.compareDocumentPosition(within(bar).getByRole('button', { name: en.cephCockpit.header.refresh })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('keeps tabs and controls on one line from lg, and lets the tab bar, then the label, then the picker give way', () => {
    renderCockpit()
    const bar = screen.getByTestId('cockpit-tabbar')
    const header = screen.getByTestId('cockpit-header')
    const label = screen.getByTestId('updated-label')

    expect(lgStyle(bar)['flex-wrap']).toBe('nowrap')
    expect(lgStyle(header)['flex-wrap']).toBe('nowrap')
    const shrink = (el: Element) => Number(getComputedStyle(el).flexShrink)
    const tabs = bar.querySelector('.MuiTabs-root') as HTMLElement
    const pickerRoot = screen.getByRole('combobox', { name: en.cephCockpit.header.cluster }).closest('.MuiFormControl-root') as HTMLElement

    // The label gives way first, then the picker (down to its minimum) and the tab bar share what is left; period and refresh never shrink.
    expect(shrink(label)).toBeGreaterThan(shrink(pickerRoot))
    expect(shrink(label)).toBeGreaterThan(shrink(tabs))
    expect(shrink(pickerRoot)).toBeGreaterThan(0)
    expect(getComputedStyle(pickerRoot).minWidth).toBe('150px')
    expect(shrink(screen.getByRole('button', { name: en.cephCockpit.header.refresh }))).toBe(0)
    expect(shrink(screen.getByRole('group', { name: en.cephCockpit.header.range }))).toBe(0)
  })

  it('hides the tab icons when the tab bar itself is too narrow (container query on lg up), not on a fixed screen width', () => {
    renderCockpit()

    expect(getComputedStyle(screen.getByTestId('cockpit-tabbar')).containerType).toBe('inline-size')
    const [query, rule] = Object.entries(TAB_ICONS_WHEN_NARROW)[0]

    expect(query).toBe(`@container ${TABBAR_CONTAINER} (max-width: ${TAB_ICONS_MIN_BAR_PX - 0.02}px)`)
    expect(rule).toEqual({ '& .MuiTab-iconWrapper': { display: 'none' } })
    // The old rule tied to the screen width is gone.
    const css = Array.from(document.querySelectorAll('style')).map(n => n.textContent ?? '').join('')

    expect(css).not.toMatch(/max-width:\s*1399/)
  })

  it('keeps the picker reachable above the body when there are no tabs', () => {
    liveState = { ...liveState, live: null, lastOkAt: null, absent: true }
    renderCockpit()

    expect(screen.queryByTestId('cockpit-tabbar')).toBeNull()
    expect(screen.getByRole('combobox', { name: en.cephCockpit.header.cluster })).toBeInTheDocument()
  })

  it('gives the period, refresh and cluster controls the same 32 px height', () => {
    renderCockpit()
    const heightOf = (el: Element) => getComputedStyle(el).height
    const group = screen.getByRole('group', { name: en.cephCockpit.header.range })
    const refresh = screen.getByRole('button', { name: en.cephCockpit.header.refresh })
    const picker = screen.getByRole('combobox', { name: en.cephCockpit.header.cluster })
    const selectRoot = picker.closest('.MuiInputBase-root') as HTMLElement

    expect(selectRoot).not.toBeNull()
    expect(heightOf(selectRoot)).toBe('32px')
    expect(heightOf(group)).toBe('32px')
    expect(heightOf(refresh)).toBe('32px')
    expect(getComputedStyle(refresh).width).toBe('32px')
    expect(heightOf(picker)).toBe('32px')
  })

  it('shows the Proxmox logo with the health pip in the picker value and in each option', () => {
    health = { c1: { status: 'HEALTH_WARN', error: false, absent: false }, c2: { status: 'HEALTH_ERR', error: false, absent: false } }
    renderCockpit()
    const picker = screen.getByRole('combobox', { name: en.cephCockpit.header.cluster })

    expect(within(picker).getByTestId('cluster-glyph-logo')).toHaveAttribute('src', '/images/proxmox-logo.svg')
    expect(within(picker).getByTestId('cluster-glyph-dot')).toHaveAttribute('data-status', 'online')
    fireEvent.mouseDown(picker)
    const options = screen.getAllByRole('option')

    expect(options).toHaveLength(2)
    for (const o of options) expect(within(o).getByTestId('cluster-glyph-logo')).toHaveAttribute('src', '/images/proxmox-logo.svg')
    expect(within(options[1]).getByTestId('cluster-glyph-dot')).toHaveAttribute('data-status', 'offline')
  })

  it('plugs a view into each of the six tabs', () => {
    expect(Object.keys(TAB_PANELS).sort()).toEqual(['crush', 'osd', 'overview', 'perf', 'pools', 'services'])
    const order = ['overview', 'osd', 'pools', 'crush', 'services', 'perf']

    for (const tab of order) {
      search = `conn=c1&tab=${tab}`
      const view = renderCockpit()
      const tabs = screen.getAllByRole('tab')

      expect(tabs, tab).toHaveLength(6)
      expect(tabs.findIndex(t => t.getAttribute('aria-selected') === 'true'), tab).toBe(order.indexOf(tab))
      view.unmount()
    }
  })

  it('switches tab through the URL and drops the item and the filter of the previous one', () => {
    search = 'conn=c1&tab=perf&item=osd.3&filter=down'
    renderCockpit()

    fireEvent.click(screen.getByRole('tab', { name: en.cephCockpit.tabs.pools }))
    expect(push).toHaveBeenCalledWith('/storage/ceph?conn=c1&tab=pools')
  })

  it('has no status sentence on the overview (the health rail carries it) and counts down OSDs on their tab', () => {
    liveState = {
      ...liveState,
      live: liveOf({
        health: { status: 'HEALTH_WARN', checks: [{ name: 'OSD_DOWN', severity: 'HEALTH_WARN', summary: '1 osds down', detail: [] }] },
        osd: { total: 3, up: 2, in: 3 },
      }),
    }
    renderCockpit()

    expect(screen.queryByTestId('status-sentence')).toBeNull()
    expect(screen.getByTestId('tab-count-osd')).toHaveTextContent('1')
  })

  it('counts pools and daemons on their tabs from the inventory', () => {
    // A partial inventory: stay off the overview, which reads the whole of it.
    search = 'conn=c1&tab=crush'
    inventoryState = {
      ...inventoryState,
      inventory: {
        osds: { list: [{ id: 0, version: '20.2.4' }, { id: 1, version: '19.2.1' }], down: 0 },
        pools: { total: 2 },
        monitors: { total: 3 },
        managers: { active: { name: 'a', host: 'pve1' }, standbys: [{ name: 'b', host: 'pve2' }] },
        mds: { total: 0 },
        health: { status: 'HEALTH_OK', checks: [], numChecks: 0 },
      },
    }
    renderCockpit()

    expect(screen.getByTestId('tab-count-pools')).toHaveTextContent('2')
    expect(screen.getByTestId('tab-count-services')).toHaveTextContent('5')
    expect(screen.queryByTestId('tab-count-osd')).toBeNull()
  })

  it('shows an error with retry when nothing could be read', () => {
    liveState = { ...liveState, live: null, lastOkAt: null, error: new Error('API error: 500') }
    renderCockpit()

    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.error.retry }))
    expect(inventoryState.reload).toHaveBeenCalled()
    expect(screen.getByTestId('cockpit-error')).toHaveTextContent(en.cephCockpit.error.title)
  })

  it('waits on a skeleton before the first read', () => {
    liveState = { ...liveState, live: null, lastOkAt: null }
    renderCockpit()

    expect(screen.queryByTestId('cockpit-body')).toBeNull()
    expect(screen.queryByTestId('cockpit-error')).toBeNull()
  })

  it('says the selected cluster runs no Ceph when its reads answer 404', () => {
    liveState = { ...liveState, live: null, lastOkAt: null, absent: true }
    renderCockpit()

    expect(screen.getByText(en.cephCockpit.empty.clusterTitle)).toBeInTheDocument()
    expect(screen.getByTestId('cockpit-header')).toBeInTheDocument()
  })

  it('changes cluster through the URL', () => {
    renderCockpit()

    fireEvent.mouseDown(screen.getByRole('combobox', { name: en.cephCockpit.header.cluster }))
    fireEvent.click(screen.getByRole('option', { name: 'PVE-DR' }))
    expect(push).toHaveBeenCalledWith('/storage/ceph?conn=c2')
  })

  it('opens the flags editor from the rail and pulses the foot on a flags link', () => {
    liveState = {
      ...liveState,
      live: liveOf({ health: { status: 'HEALTH_WARN', checks: [{ name: 'OSDMAP_FLAGS', severity: 'HEALTH_WARN', summary: 'noout flag(s) set', detail: [] }] } }),
    }
    renderCockpit()

    fireEvent.click(within(screen.getByTestId('rail-check')).getByTestId('rail-link'))
    expect(push).toHaveBeenCalledWith('/storage/ceph?conn=c1&tab=overview')
    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.rail.editFlags }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('sends a PG health check to the Performance tab through the URL', () => {
    liveState = {
      ...liveState,
      live: liveOf({ health: { status: 'HEALTH_WARN', checks: [{ name: 'PG_DEGRADED', severity: 'HEALTH_WARN', summary: '3 pgs degraded', detail: [] }] } }),
    }
    renderCockpit()

    fireEvent.click(within(screen.getByTestId('rail-check')).getByTestId('rail-link'))
    expect(push).toHaveBeenCalledWith('/storage/ceph?conn=c1&tab=perf')
  })

  it('does not scroll the overview again after a tab picked by hand', () => {
    const scroll = vi.fn()

    Element.prototype.scrollIntoView = scroll
    liveState = {
      ...liveState,
      live: liveOf({ health: { status: 'HEALTH_WARN', checks: [{ name: 'OSDMAP_FLAGS', severity: 'HEALTH_WARN', summary: 'noout flag(s) set', detail: [] }] } }),
    }
    const view = renderCockpit()

    fireEvent.click(within(screen.getByTestId('rail-check')).getByTestId('rail-link'))
    expect(scroll).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('tab', { name: en.cephCockpit.tabs.crush }))
    search = 'conn=c1&tab=crush'
    view.rerender(cockpitTree())
    search = 'conn=c1&tab=overview'
    view.rerender(cockpitTree())
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('Community: the session latency points keep accumulating on another tab and are there when the OSD tab comes back', () => {
    license = { enterprise: false, resolved: true }
    const osd = (id: number, ms: number) => ({ id, name: `osd.${id}`, host: 'pve1', status: 'up', up: true, in: true, deviceClass: 'hdd', totalBytes: 1, usedBytes: 0, availBytes: 0, usedPct: 10, commitLatencyMs: ms, applyLatencyMs: ms, reweight: 1, pgs: 1, version: '20' })
    const inventoryAt = (at: number, ms: number) => ({
      hasCeph: true, health: { status: 'HEALTH_OK', checks: [], numChecks: 0 },
      osds: { total: 1, up: 1, in: 1, down: 0, out: 0, list: [osd(0, ms)] },
      monitors: { total: 0, inQuorum: 0, quorumNames: [], list: [] }, managers: { active: null, standbys: [] }, mds: { total: 0, list: [] },
      pools: { total: 0, list: [] }, crushTree: [], crushRules: [], pveNodes: ['pve1'], capacity: {}, performance: {}, pgs: { total: 0, states: [] },
    })
    const read = (at: number, ms: number) => { inventoryState = { ...inventoryState, inventory: inventoryAt(at, ms), lastOkAt: at } }

    search = 'conn=c1&tab=osd'
    read(1, 2)
    const view = renderCockpit()

    expect(screen.getByTestId('osd-trend-collecting')).toBeInTheDocument()
    search = 'conn=c1&tab=crush'
    read(2, 3)
    view.rerender(cockpitTree())
    read(3, 4)
    view.rerender(cockpitTree())
    search = 'conn=c1&tab=osd'
    view.rerender(cockpitTree())
    expect(screen.getByTestId('osd-trend').getAttribute('aria-label')).toContain('2 / 3 / 4 ms')
  })

  it('no latency point is accumulated while the licence is not resolved', () => {
    license = { enterprise: false, resolved: false }
    const list = [{ id: 0, name: 'osd.0', host: 'pve1', status: 'up', up: true, in: true, deviceClass: 'hdd', totalBytes: 1, usedBytes: 0, availBytes: 0, usedPct: 10, commitLatencyMs: 2, applyLatencyMs: 2, reweight: 1, pgs: 1, version: '20' }]
    const inventoryAt = (at: number) => ({ inventory: {
      hasCeph: true, health: { status: 'HEALTH_OK', checks: [], numChecks: 0 }, osds: { total: 1, up: 1, in: 1, down: 0, out: 0, list },
      monitors: { total: 0, inQuorum: 0, quorumNames: [], list: [] }, managers: { active: null, standbys: [] }, mds: { total: 0, list: [] },
      pools: { total: 0, list: [] }, crushTree: [], crushRules: [], pveNodes: ['pve1'], capacity: {}, performance: {}, pgs: { total: 0, states: [] },
    }, lastOkAt: at })

    search = 'conn=c1&tab=osd'
    inventoryState = { ...inventoryState, ...inventoryAt(1) }
    const view = renderCockpit()

    inventoryState = { ...inventoryState, ...inventoryAt(2) }
    view.rerender(cockpitTree())
    license = { enterprise: false, resolved: true }
    view.rerender(cockpitTree())
    // Only the reading current at resolution counts: a single point, so still "collecting".
    expect(screen.getByTestId('osd-trend-collecting')).toBeInTheDocument()
    inventoryState = { ...inventoryState, ...inventoryAt(3) }
    view.rerender(cockpitTree())
    expect(screen.getByTestId('osd-trend').getAttribute('aria-label')).toContain('2 / 2 / 2 ms')
  })
})
