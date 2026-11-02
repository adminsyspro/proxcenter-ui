import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'

import en from '@/messages/en.json'
import type { CephInventory, CockpitItem, OsdFilter } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import OsdTab from './OsdTab'
import { FILL_COLUMN, lgStyle } from './fillTestUtils'

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
let permissions: string[] = ['storage.admin', 'node.manage']

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: (p: string) => permissions.includes(p) }) }))

const theme = createTheme()
const GiB = 1024 ** 3
const TiB = 1024 ** 4

const osd = (id: number, host: string, over: Record<string, unknown> = {}) => ({
  id, name: `osd.${id}`, host, status: 'up', up: true, in: true, deviceClass: 'hdd', totalBytes: 0.1 * TiB, usedBytes: 0, availBytes: 0,
  usedPct: 50, commitLatencyMs: 1.5, applyLatencyMs: 1.5, reweight: 1, pgs: 43, version: '20.2.4', ...over,
})

const inventoryOf = (list: ReturnType<typeof osd>[], checks: unknown[] = [], nodes: string[] = ['pve1', 'pve2', 'pve3']) => ({
  hasCeph: true,
  health: { status: 'HEALTH_OK', checks, numChecks: checks.length },
  osds: { total: list.length, up: list.length, in: list.length, down: 0, out: 0, list },
  monitors: { total: 0, inQuorum: 0, quorumNames: [], list: [] },
  managers: { active: null, standbys: [] },
  mds: { total: 0, list: [] },
  pools: { total: 1, list: [{ id: 1, name: 'ceph-vm', size: 3, minSize: 2, crushRule: 0, crushRootId: -1 }] },
  crushTree: [],
  crushRules: [],
  pveNodes: nodes,
}) as unknown as CephInventory

const SMALL = [
  osd(0, 'pve1', { usedPct: 81 }),
  osd(1, 'pve2', { usedPct: 82 }),
  osd(2, 'pve3', { usedPct: 79 }),
  osd(3, 'pve3', { usedPct: 88 }),
]

function propsOf(over: { list?: ReturnType<typeof osd>[]; item?: CockpitItem | null; filter?: OsdFilter; hostFlags?: Record<string, string[]>; nodes?: string[]; ratios?: { nearfull: number; full: number }; buffer?: Record<number, { time: number; avg: number; max: number }[]> } = {}) {
  const set = vi.fn()
  const reload = vi.fn()
  const props = {
    conn: 'c1',
    live: { live: null, buffer: [], error: null, lastOkAt: 1, absent: false, stale: false, refresh: vi.fn() },
    inventory: { inventory: inventoryOf(over.list ?? SMALL, [], over.nodes), absent: false, error: null, lastOkAt: 1, stale: false, reload },
    url: { conn: 'c1', tab: 'osd', item: over.item ?? null, filter: over.filter ?? 'all', range: 'live', hosts: 'all', map: null, set },
    enterprise: true,
    ratios: over.ratios ?? { nearfull: 0.85, full: 0.95 },
    focus: null,
    osdFlags: { flags: [], hostFlags: over.hostFlags ?? {}, osdFlags: {}, loading: false, toggling: null, forbidden: false, toggle: vi.fn(), toggleHost: vi.fn() },
    latencyBuffer: over.buffer ?? {},
    onNavigate: vi.fn(),
  } as unknown as CockpitTabProps

  return { props, set, reload }
}

function renderTab(props: CockpitTabProps) {
  const view = render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <SWRConfig value={{ provider: () => new Map() }}>
        <ThemeProvider theme={theme}>
          <OsdTab {...props} />
        </ThemeProvider>
      </SWRConfig>
    </NextIntlClientProvider>,
  )

  return {
    ...view,
    rerenderTab: (next: CockpitTabProps) => view.rerender(
      <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <ThemeProvider theme={theme}>
            <OsdTab {...next} />
          </ThemeProvider>
        </SWRConfig>
      </NextIntlClientProvider>,
    ),
  }
}

const jsonRes = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
type Handler = (url: string, init?: RequestInit) => ReturnType<typeof jsonRes> | undefined
let handlers: Handler[] = []
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  for (const h of handlers) {
    const r = h(String(url), init)

    if (r) return r
  }
  if (String(url).includes('/ceph/noout')) return jsonRes({ data: { hasCeph: false } })
  if (String(url).includes('/history')) return jsonRes({}, 404)
  if (String(url).includes('/ceph/exporter')) return jsonRes({ code: 'exporter_unreachable', error: 'x' }, 503)

  return jsonRes({ error: 'unexpected ' + url }, 500)
})
const OK = { ok: true, osds: [1], numOkPgs: 43, numNotOkPgs: 0, message: null }
const REFUSED = { ok: false, osds: [1], numOkPgs: 0, numNotOkPgs: 43, message: null }
const okToStop = (payload: unknown, status = 200): Handler => (url, init) => (url.endsWith('/ok-to-stop') && init?.method === 'POST' ? jsonRes(status < 400 ? { data: payload } : { error: 'x' }, status) : undefined)
const osdRoute = (result: ReturnType<typeof jsonRes>): Handler => (url, init) => (/\/ceph\/osd\/\d+$/.test(url) && init?.method === 'POST' ? result : undefined)
const serviceRoute = (result: ReturnType<typeof jsonRes>): Handler => (url, init) => (url.endsWith('/ceph/service') && init?.method === 'POST' ? result : undefined)
const posts = (suffix: string) => fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith(suffix) && i?.method === 'POST')
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body))

beforeEach(() => {
  handlers = []
  fetchMock.mockClear()
  Object.values(toast).forEach(f => f.mockClear())
  permissions = ['storage.admin', 'node.manage']
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const drawer = () => screen.getByTestId('osd-drawer')
const inDrawer = (name: RegExp | string) => within(drawer()).getByRole('button', { name })

describe('OsdTab table', () => {
  it('below lg: the OsdTab has no fill style, natural flow', () => {
    renderTab(propsOf().props)

    const root = screen.getByTestId('osd-tab')

    expect(root).not.toHaveStyle({ flexGrow: '1' })
    expect(root).not.toHaveStyle({ minHeight: '0px' })
  })

  it('wide: the table card goes down to the bottom and the pager stays at its foot', () => {
    renderTab(propsOf().props)

    expect(lgStyle(screen.getByTestId('osd-tab'))).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('osd-card'))).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('osd-table'))).toMatchObject({ flex: '1 1 auto', 'min-height': '0px' })
  })

  it('leads the host group with the Proxmox logo and each OSD row with the disk glyph', () => {
    const { props } = propsOf()

    ;(props.inventory as { inventory: CephInventory }).inventory.pveNodeStatus = { pve1: 'online', pve2: 'online', pve3: 'offline' }
    renderTab(props)

    expect(screen.getByTestId('osd-group-pve3').querySelector('img')).toHaveAttribute('src', expect.stringContaining('proxmox-logo'))
    expect(screen.getByTestId('osd-group-pve3').querySelector('img')?.nextElementSibling).toHaveStyle({ backgroundColor: 'rgb(244, 67, 54)' })
    const rows = screen.getAllByTestId('osd-row')

    expect(rows).toHaveLength(4)
    for (const r of rows) expect(r.querySelector('[data-testid="osd-glyph"] i.ri-hard-drive-2-line')).not.toBeNull()
  })

  it('lists the OSDs grouped by host with their counts', () => {
    renderTab(propsOf().props)

    expect(screen.getAllByTestId('osd-row')).toHaveLength(4)
    expect(within(screen.getByTestId('osd-group-pve3')).getByText('pve3')).toBeInTheDocument()
    expect(screen.getByTestId('osd-group-pve3')).toHaveTextContent('2 OSDs')
    expect(screen.getByRole('button', { name: /^All\s*4$/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^With a problem\s*1$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Down\s*0$/ })).toBeInTheDocument()
  })

  it('the quick filters write the URL and the rows follow the filter of the URL', () => {
    const { props, set } = propsOf({ filter: 'down' })

    renderTab(props)
    expect(screen.queryAllByTestId('osd-row')).toHaveLength(0)
    expect(screen.getByText(en.cephCockpit.osd.emptyFiltered)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Out/ }))

    expect(set).toHaveBeenCalledWith({ filter: 'out' })
  })

  it('searches by name and host, and shows the empty message', () => {
    renderTab(propsOf().props)

    fireEvent.change(screen.getByPlaceholderText(en.cephCockpit.osd.search), { target: { value: 'osd.2' } })
    expect(screen.getAllByTestId('osd-row')).toHaveLength(1)
    fireEvent.change(screen.getByPlaceholderText(en.cephCockpit.osd.search), { target: { value: 'zzz' } })
    expect(screen.getByText(en.cephCockpit.osd.emptyFiltered)).toBeInTheDocument()
  })

  it('a click on a row writes item=osd.N', () => {
    const { props, set } = propsOf()

    renderTab(props)
    fireEvent.click(screen.getAllByTestId('osd-row')[2])

    expect(set).toHaveBeenCalledWith({ item: { kind: 'osd', id: 2 } })
  })

  it('folds a host group', () => {
    renderTab(propsOf().props)

    fireEvent.click(screen.getByRole('button', { name: 'Fold pve3' }))
    expect(screen.getAllByTestId('osd-row')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Unfold pve3' }))
    expect(screen.getAllByTestId('osd-row')).toHaveLength(4)
  })

  it('paginates above 20 rows', () => {
    const list = Array.from({ length: 25 }, (_, i) => osd(i, `pve${(i % 5) + 1}`))

    renderTab(propsOf({ list }).props)

    expect(screen.getAllByTestId('osd-row')).toHaveLength(20)
    expect(screen.getByTestId('osd-pager')).toHaveTextContent('1 to 20 of 25')
    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.osd.pager.next }))
    expect(screen.getAllByTestId('osd-row')).toHaveLength(5)
    expect(screen.getByTestId('osd-pager')).toHaveTextContent('21 to 25 of 25')
    expect(screen.getByRole('button', { name: en.cephCockpit.osd.pager.next })).toBeDisabled()
  })

  it('has no pager up to 20 rows', () => {
    renderTab(propsOf().props)

    expect(screen.queryByTestId('osd-pager')).toBeNull()
  })

  it('draws the noout chip of a host that carries the flag, and only of that one', async () => {
    handlers = [url => (url.includes('/nodes/pve3/ceph/noout') ? jsonRes({ data: { hasCeph: true, crushHost: 'pve3', osds: [{ id: 2, status: 'up', in: true }], noout: true, hostFlags: ['noout'] } }) : undefined)]
    renderTab(propsOf({ hostFlags: { pve3: ['noout'] } }).props)

    await waitFor(() => expect(within(screen.getByTestId('osd-group-pve3')).getByTestId('ceph-noout-chip')).toBeInTheDocument())
    expect(within(screen.getByTestId('osd-group-pve1')).queryByTestId('ceph-noout-chip')).toBeNull()
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/ceph/noout')).every(([u]) => String(u).includes('/nodes/pve3/'))).toBe(true)
  })

  it('marks the OSD a health check cites', () => {
    const checks = [{ name: 'OSD_SCRUB_ERRORS', severity: 'HEALTH_ERR', summary: 'x', detail: [{ message: 'pg 1.0 is active+clean+inconsistent, acting [1,0,2]' }] }]
    const { props } = propsOf()

    ;(props.inventory as { inventory: CephInventory }).inventory = inventoryOf(SMALL, checks)
    renderTab(props)

    expect(screen.getAllByTestId('osd-row')[1]).toHaveAttribute('data-state', 'error')
    expect(screen.getAllByTestId('osd-row')[0]).toHaveAttribute('data-state', 'ok')
    expect(within(screen.getAllByTestId('osd-row')[1]).getByRole('img', { name: '1 health check cites this OSD' })).toBeInTheDocument()
  })
})

describe('OsdTab drawer', () => {
  it('url item=osd.3 opens drawer on load', () => {
    renderTab(propsOf({ item: { kind: 'osd', id: 3 } }).props)

    expect(drawer()).toHaveTextContent('osd.3')
    expect(drawer()).toHaveTextContent('pve3')
    expect(drawer()).toHaveTextContent('20.2.4')
  })

  it('stays closed when the item is not an OSD of the inventory', () => {
    renderTab(propsOf({ item: { kind: 'osd', id: 99 } }).props)

    expect(screen.queryByTestId('osd-drawer')).toBeNull()
  })

  it('drawer arrow keys move to next osd', () => {
    const { props, set } = propsOf({ item: { kind: 'osd', id: 1 } })

    renderTab(props)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(set).toHaveBeenLastCalledWith({ item: { kind: 'osd', id: 2 } })
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(set).toHaveBeenLastCalledWith({ item: { kind: 'osd', id: 0 } })
  })

  it('arrow keys stop at both ends and are left alone while typing', () => {
    const first = propsOf({ item: { kind: 'osd', id: 0 } })

    renderTab(first.props)
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(first.set).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByPlaceholderText(en.cephCockpit.osd.search), { key: 'ArrowDown' })
    expect(first.set).not.toHaveBeenCalled()
  })

  it('the close button clears the item', () => {
    const { props, set } = propsOf({ item: { kind: 'osd', id: 1 } })

    renderTab(props)
    fireEvent.click(inDrawer(en.cephCockpit.osd.drawer.close))
    expect(set).toHaveBeenCalledWith({ item: null })
  })

  it('opens as a centered dialog, not a side drawer', () => {
    renderTab(propsOf({ item: { kind: 'osd', id: 3 } }).props)

    const dialog = screen.getByRole('dialog')

    expect(dialog).toBe(drawer())
    expect(dialog.closest('.MuiDialog-root')).not.toBeNull()
    expect(document.querySelector('.MuiDrawer-root')).toBeNull()
  })

  it('the dialog is named by its title', () => {
    renderTab(propsOf({ item: { kind: 'osd', id: 3 } }).props)
    expect(screen.getByRole('dialog', { name: 'osd.3' })).toBe(drawer())
  })

  it('shows up / in as the first property row, with the other properties', () => {
    renderTab(propsOf({ item: { kind: 'osd', id: 3 } }).props)

    const properties = within(drawer()).getByTestId('osd-drawer-properties')
    const row = within(properties).getByTestId('osd-drawer-state-row')
    const state = within(row).getByTestId('osd-drawer-state')

    expect(properties.firstElementChild).toBe(row)
    expect(row).toHaveTextContent(/^State/)
    expect(within(state).getByText('up')).toBeTruthy()
    expect(within(state).getByText('in')).toBeTruthy()
    expect(within(state).queryByText('down')).toBeNull()
    expect(within(state).queryByText('out')).toBeNull()
  })

  it('shows down / out in the state row of a stopped OSD that left the cluster', () => {
    renderTab(propsOf({ list: [osd(5, 'pve1', { up: false, in: false })], item: { kind: 'osd', id: 5 } }).props)

    const state = within(drawer()).getByTestId('osd-drawer-state')

    expect(within(state).getByText('down')).toBeTruthy()
    expect(within(state).getByText('out')).toBeTruthy()
    expect(within(state).queryByText('up')).toBeNull()
    expect(within(state).queryByText('in')).toBeNull()
  })

  it('the truncated subtitle carries its full text as a native tooltip', () => {
    renderTab(propsOf({ item: { kind: 'osd', id: 3 } }).props)
    expect(within(drawer()).getByTitle('pve3 \u00b7 hdd \u00b7 Ceph 20.2.4')).toBeTruthy()
  })

  it('arrows typed from inside the scrolling body scroll it: no navigation, no preventDefault', () => {
    const { props, set } = propsOf({ item: { kind: 'osd', id: 1 } })

    renderTab(props)

    const body = drawer().querySelector('.MuiDialogContent-root') as HTMLElement
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })

    body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(set).not.toHaveBeenCalled()
  })

  it('arrows do not navigate nor get prevented when the sheet is full screen', () => {
    const original = window.matchMedia

    window.matchMedia = ((query: string) => ({ matches: true, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) as unknown as typeof window.matchMedia
    try {
      const { props, set } = propsOf({ item: { kind: 'osd', id: 1 } })

      renderTab(props)

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })

      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(set).not.toHaveBeenCalled()
    } finally {
      window.matchMedia = original
    }
  })

  it('Escape closes the sheet and clears the item', () => {
    const { props, set } = propsOf({ item: { kind: 'osd', id: 1 } })

    renderTab(props)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(set).toHaveBeenCalledWith({ item: null })
  })

  it('the previous and next buttons move to the neighbour OSD', () => {
    const { props, set } = propsOf({ item: { kind: 'osd', id: 1 } })

    renderTab(props)
    fireEvent.click(inDrawer(en.cephCockpit.osd.drawer.next))
    expect(set).toHaveBeenLastCalledWith({ item: { kind: 'osd', id: 2 } })
    fireEvent.click(inDrawer(en.cephCockpit.osd.drawer.prev))
    expect(set).toHaveBeenLastCalledWith({ item: { kind: 'osd', id: 0 } })
  })

  it('the confirmation opens above the sheet and its Cancel button works without running anything', async () => {
    handlers = [okToStop(OK)]
    const { props, set } = propsOf({ item: { kind: 'osd', id: 1 } })

    renderTab(props)
    fireEvent.click(inDrawer('Mark out'))

    const form = await screen.findByTestId('osd-confirm-form')

    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2)
    expect(form.closest('.MuiDialog-root')).not.toBe(drawer().closest('.MuiDialog-root'))
    fireEvent.click(within(form).getByRole('button', { name: en.cephCockpit.osd.confirm.cancel }))
    await waitFor(() => expect(screen.queryByTestId('osd-confirm-form')).toBeNull())
    expect(posts('/ceph/osd/1')).toHaveLength(0)
    expect(set).not.toHaveBeenCalled()
    expect(drawer()).toBeInTheDocument()
  })

  it('moves to the page of the OSD the drawer is on', () => {
    const list = Array.from({ length: 25 }, (_, i) => osd(i, 'pve1'))

    renderTab(propsOf({ list, item: { kind: 'osd', id: 22 } }).props)

    expect(screen.getByTestId('osd-pager')).toHaveTextContent('21 to 25 of 25')
  })

  it('deep-scrub posts action without modal', async () => {
    handlers = [osdRoute(jsonRes({ data: { upid: 'UPID:1', node: 'pve2', osd: 1, action: 'deep-scrub' } }))]
    const { props, reload } = propsOf({ item: { kind: 'osd', id: 1 } })

    renderTab(props)
    fireEvent.click(inDrawer('Deep-scrub'))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deep-scrub of osd.1 requested'))
    const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/v1/connections/c1/nodes/pve2/ceph/osd/1')!

    expect((call[1] as RequestInit).method).toBe('POST')
    expect(bodyOf(call)).toEqual({ action: 'deep-scrub' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByTestId('osd-confirm-form')).toBeNull()
    expect(reload).toHaveBeenCalled()
  })

  it('scrub and in post their action; a failure toasts the error', async () => {
    handlers = [osdRoute(jsonRes({ error: 'boom' }, 500))]
    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list: [osd(0, 'pve1'), osd(1, 'pve2', { in: false })] }).props)

    fireEvent.click(inDrawer('Scrub'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Action on osd.1 failed: boom'))
    expect(bodyOf(posts('/ceph/osd/1')[0])).toEqual({ action: 'scrub' })

    fireEvent.click(inDrawer('Mark in'))
    await waitFor(() => expect(posts('/ceph/osd/1')).toHaveLength(2))
    expect(bodyOf(posts('/ceph/osd/1')[1])).toEqual({ action: 'in' })
  })

  it('disables each action that makes no sense and all of them without permission', () => {
    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list: [osd(0, 'pve1'), osd(1, 'pve2', { in: false, up: false, status: 'down' })] }).props)

    expect(inDrawer('Mark out')).toBeDisabled()
    expect(inDrawer('Stop')).toBeDisabled()
    expect(within(drawer()).queryByRole('button', { name: 'Restart' })).toBeNull()
    expect(inDrawer('Start')).toBeEnabled()
    expect(inDrawer('Mark in')).toBeEnabled()

    cleanup()
    permissions = []
    renderTab(propsOf({ item: { kind: 'osd', id: 1 } }).props)
    for (const name of ['Scrub', 'Deep-scrub', 'Mark in', 'Mark out', 'Stop', 'Restart']) expect(inDrawer(name)).toBeDisabled()
  })

  it('out with ok verdict and low impact confirms without typing, then posts without force', async () => {
    handlers = [okToStop(OK), osdRoute(jsonRes({ data: { upid: 'UPID:2', node: 'pve2', osd: 1, action: 'out' } }))]
    const { props, reload } = propsOf({ item: { kind: 'osd', id: 1 }, list: [osd(0, 'pve1', { usedPct: 10 }), osd(1, 'pve2', { usedPct: 10 }), osd(2, 'pve3', { usedPct: 10 })] })

    renderTab(props)
    fireEvent.click(inDrawer('Mark out'))

    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    expect(posts('/ceph/osd/1/ok-to-stop')).toHaveLength(1)
    expect(screen.queryByLabelText(en.cephCockpit.osd.confirm.typeLabel)).toBeNull()
    fireEvent.click(within(screen.getByTestId('osd-confirm-form')).getByRole('button', { name: 'Mark out' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('osd.1 is being marked out'))
    expect(bodyOf(posts('/ceph/osd/1')[0])).toEqual({ action: 'out', force: false })
    expect(reload).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('osd-confirm-form')).toBeNull())
  })

  // R31: the thresholds come from the page's ratios prop, never from the precheck, and drive the typed confirmation.
  it('asks for the name when the projection passes the nearfull of the ratios prop', async () => {
    const list = [osd(0, 'pve1', { usedPct: 52 }), osd(1, 'pve2', { usedPct: 52 }), osd(2, 'pve3', { usedPct: 52 })]

    handlers = [okToStop(OK)]
    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list }).props)
    fireEvent.click(inDrawer('Mark out'))
    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    expect(screen.queryByLabelText(en.cephCockpit.osd.confirm.typeLabel)).toBeNull()

    cleanup()
    handlers = [okToStop(OK)]
    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list, ratios: { nearfull: 0.75, full: 0.9 } }).props)
    fireEvent.click(inDrawer('Mark out'))
    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    expect(await screen.findByLabelText(en.cephCockpit.osd.confirm.typeLabel)).toBeInTheDocument()
  })

  it('ignores a ratios field in the precheck answer: the thresholds stay those of the page', async () => {
    const list = [osd(0, 'pve1', { usedPct: 52 }), osd(1, 'pve2', { usedPct: 52 }), osd(2, 'pve3', { usedPct: 52 })]

    handlers = [okToStop({ ...OK, ratios: { nearfull: 0.75, full: 0.9 } })]
    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list }).props)
    fireEvent.click(inDrawer('Mark out'))
    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    expect(screen.queryByLabelText(en.cephCockpit.osd.confirm.typeLabel)).toBeNull()
  })

  it('out with refused verdict requires typing osd name then sends force', async () => {
    handlers = [okToStop(REFUSED), osdRoute(jsonRes({ data: { upid: 'UPID:3' } }))]

    renderTab(propsOf({ item: { kind: 'osd', id: 1 } }).props)
    fireEvent.click(inDrawer('Mark out'))

    const form = await screen.findByTestId('osd-confirm-form')

    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'refused'))
    expect(within(form).getByRole('button', { name: 'Mark out anyway' })).toBeDisabled()
    fireEvent.change(within(form).getByLabelText(en.cephCockpit.osd.confirm.typeLabel), { target: { value: 'osd.1' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Mark out anyway' }))

    await waitFor(() => expect(posts('/ceph/osd/1')).toHaveLength(1))
    expect(bodyOf(posts('/ceph/osd/1')[0])).toEqual({ action: 'out', force: true })
  })

  it('a verdict that cannot be obtained counts as unknown and asks for the name', async () => {
    handlers = [okToStop(null, 500)]

    renderTab(propsOf({ item: { kind: 'osd', id: 1 } }).props)
    fireEvent.click(inDrawer('Mark out'))

    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'unknown'))
    expect(screen.getByRole('button', { name: 'Mark out anyway' })).toBeDisabled()
    expect(posts('/ceph/osd/1')).toHaveLength(0)
  })

  it('does not let the modal be confirmed before the verdict is back', async () => {
    let release: (v: ReturnType<typeof jsonRes>) => void = () => undefined
    const pending = new Promise<ReturnType<typeof jsonRes>>(resolve => { release = resolve })

    // Only the ok-to-stop call waits: the sheet also reads the exporter route on its own.
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>

    fetchMock.mockImplementation(((url: string, init?: RequestInit) => (String(url).endsWith('/ok-to-stop') ? pending : base(url, init))) as typeof fetchMock)
    renderTab(propsOf({ item: { kind: 'osd', id: 1 } }).props)
    fireEvent.click(inDrawer('Mark out'))

    const form = await screen.findByTestId('osd-confirm-form')

    expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'checking')
    expect(within(form).getByRole('button', { name: 'Mark out' })).toBeDisabled()
    fireEvent.submit(form)
    expect(posts('/ceph/osd/1')).toHaveLength(0)
    await act(async () => { release(jsonRes({ data: OK })) })
    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    fetchMock.mockImplementation(base as typeof fetchMock)
  })

  it('projected over nearfull requires typing even with an ok verdict', async () => {
    handlers = [okToStop(OK)]
    // Two OSD only: the other one takes everything and ends past nearfull.
    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list: [osd(0, 'pve1', { usedPct: 80 }), osd(1, 'pve2', { usedPct: 80 })] }).props)
    fireEvent.click(inDrawer('Mark out'))

    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    expect(screen.getByRole('button', { name: 'Mark out anyway' })).toBeDisabled()
    expect(screen.getByLabelText(en.cephCockpit.osd.confirm.typeLabel)).toBeInTheDocument()
  })

  it('stop goes through the service route and forces only after typing', async () => {
    handlers = [okToStop(REFUSED), serviceRoute(jsonRes({ data: { upid: 'UPID:4' } }))]

    renderTab(propsOf({ item: { kind: 'osd', id: 1 } }).props)
    fireEvent.click(inDrawer('Stop'))

    const form = await screen.findByTestId('osd-confirm-form')

    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'refused'))
    fireEvent.change(within(form).getByLabelText(en.cephCockpit.osd.confirm.typeLabel), { target: { value: 'osd.1' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Stop anyway' }))

    await waitFor(() => expect(posts('/ceph/service')).toHaveLength(1))
    expect(bodyOf(posts('/ceph/service')[0])).toEqual({ action: 'stop', service: 'osd.1', force: true })
    expect(String(posts('/ceph/service')[0][0])).toBe('/api/v1/connections/c1/nodes/pve2/ceph/service')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Task started: stopping osd.1'))
  })

  it('restart with an ok verdict goes without force, and a late 409 turns into a typed confirmation', async () => {
    const calm = [osd(0, 'pve1', { usedPct: 10 }), osd(1, 'pve2', { usedPct: 10 }), osd(2, 'pve3', { usedPct: 10 })]

    handlers = [okToStop(OK), serviceRoute(jsonRes({ error: 'unsafe', code: 'not_ok_to_stop', okToStop: { ok: false, osds: [1], numOkPgs: 0, numNotOkPgs: 12 } }, 409))]
    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list: calm }).props)
    fireEvent.click(inDrawer('Restart'))

    const form = await screen.findByTestId('osd-confirm-form')

    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    fireEvent.click(within(form).getByRole('button', { name: 'Restart' }))

    await waitFor(() => expect(screen.getByTestId('osd-notice')).toHaveTextContent('Ceph now refuses this action'))
    expect(bodyOf(posts('/ceph/service')[0])).toEqual({ action: 'restart', service: 'osd.1', force: false })
    expect(screen.getByTestId('osd-verdict')).toHaveTextContent('12 placement groups would go offline')
    expect(within(form).getByRole('button', { name: 'Restart anyway' })).toBeDisabled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the modal open and shows the error when the action fails, and arrows do not move the drawer meanwhile', async () => {
    handlers = [okToStop(OK), osdRoute(jsonRes({ error: 'PVE down' }, 500))]
    const calm = [osd(0, 'pve1', { usedPct: 10 }), osd(1, 'pve2', { usedPct: 10 }), osd(2, 'pve3', { usedPct: 10 })]
    const { props, set } = propsOf({ item: { kind: 'osd', id: 1 }, list: calm })

    renderTab(props)
    fireEvent.click(inDrawer('Mark out'))

    const form = await screen.findByTestId('osd-confirm-form')

    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(set).not.toHaveBeenCalled()
    fireEvent.click(within(form).getByRole('button', { name: 'Mark out' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The action failed: PVE down'))
    expect(screen.getByTestId('osd-confirm-form')).toBeInTheDocument()
  })

  it('Start of a down OSD goes through the service route at once, without a modal', async () => {
    handlers = [serviceRoute(jsonRes({ data: { upid: 'UPID:5' } }))]

    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list: [osd(0, 'pve1'), osd(1, 'pve2', { up: false, status: 'down' })] }).props)
    fireEvent.click(inDrawer('Start'))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Task started: starting osd.1'))
    expect(bodyOf(posts('/ceph/service')[0])).toEqual({ action: 'start', service: 'osd.1', force: false })
    expect(screen.queryByTestId('osd-confirm-form')).toBeNull()
  })

  it('sends every call to the PVE node when the CRUSH host carries the FQDN', async () => {
    handlers = [okToStop(REFUSED), osdRoute(jsonRes({ data: { upid: 'UPID:6' } })), serviceRoute(jsonRes({ data: { upid: 'UPID:7' } }))]
    const list = [osd(0, 'pve1.example.lan'), osd(1, 'pve2.example.lan')]

    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list }).props)
    fireEvent.click(inDrawer('Deep-scrub'))
    await waitFor(() => expect(posts('/ceph/osd/1')).toHaveLength(1))
    expect(String(posts('/ceph/osd/1')[0][0])).toBe('/api/v1/connections/c1/nodes/pve2/ceph/osd/1')

    fireEvent.click(inDrawer('Stop'))
    await screen.findByTestId('osd-confirm-form')
    await waitFor(() => expect(posts('/ok-to-stop')).toHaveLength(1))
    expect(String(posts('/ok-to-stop')[0][0])).toBe('/api/v1/connections/c1/nodes/pve2/ceph/osd/1/ok-to-stop')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('example.lan'))).toBe(false)
  })

  it('disables the actions with a reason when no node matches the CRUSH host', () => {
    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, nodes: ['other1', 'other2'] }).props)

    for (const name of ['Scrub', 'Deep-scrub', 'Mark in', 'Mark out', 'Stop', 'Restart']) expect(inDrawer(name)).toBeDisabled()
    fireEvent.click(inDrawer('Deep-scrub'))
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toEqual([])
    // The host matches no PVE node: nothing to scrape either.
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/ceph/exporter'))).toEqual([])
  })

  it('out of a down OSD asks for the name even with an ok verdict, and says the estimate is impossible', async () => {
    handlers = [okToStop(OK)]
    const list = [osd(0, 'pve1', { usedPct: 10 }), osd(1, 'pve2', { up: false, status: 'down', usedPct: 0 }), osd(2, 'pve3', { usedPct: 10 })]

    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list }).props)
    fireEvent.click(inDrawer('Mark out'))

    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    expect(screen.getByTestId('osd-impact')).toHaveTextContent('Estimate impossible')
    expect(screen.getByRole('button', { name: 'Mark out anyway' })).toBeDisabled()
    expect(screen.getByLabelText(en.cephCockpit.osd.confirm.typeLabel)).toBeInTheDocument()
  })

  it('a name typed only for the projection leaves force off, the server asking Ceph again', async () => {
    handlers = [okToStop(OK), osdRoute(jsonRes({ data: { upid: 'UPID:8' } }))]

    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list: [osd(0, 'pve1', { usedPct: 80 }), osd(1, 'pve2', { usedPct: 80 })] }).props)
    fireEvent.click(inDrawer('Mark out'))
    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    fireEvent.change(screen.getByLabelText(en.cephCockpit.osd.confirm.typeLabel), { target: { value: 'osd.1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark out anyway' }))

    await waitFor(() => expect(posts('/ceph/osd/1')).toHaveLength(1))
    expect(bodyOf(posts('/ceph/osd/1')[0])).toEqual({ action: 'out', force: false })
  })

  it('shows the devices the inventory reports', () => {
    const list = [osd(0, 'pve1'), osd(1, 'pve2', { osdType: 'bluestore', dataDevice: '/dev/dm-0', dbDevice: null, walDevice: '/dev/sdc1' })]

    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list }).props)

    expect(drawer()).toHaveTextContent('bluestore')
    expect(drawer()).toHaveTextContent('/dev/dm-0')
    expect(drawer()).toHaveTextContent('/dev/sdc1')
    expect(drawer()).toHaveTextContent(`DB device${en.cephCockpit.osd.drawer.onDataDevice}`)
  })

  it('draws the fill gauges with the ratios of the cluster, not fixed ones', () => {
    renderTab(propsOf({ ratios: { nearfull: 0.7, full: 0.9 } }).props)

    expect(screen.getAllByRole('meter')[0]).toHaveAttribute('aria-label', expect.stringContaining('nearfull at 70 %'))
  })

  it('nearfull + name typed + late 409: the field is empty, the button disabled and a new typing is required', async () => {
    handlers = [
      okToStop(OK),
      osdRoute(jsonRes({ error: 'unsafe', code: 'not_ok_to_stop', okToStop: { ok: false, osds: [1], numOkPgs: 0, numNotOkPgs: 7 } }, 409)),
    ]

    renderTab(propsOf({ item: { kind: 'osd', id: 1 }, list: [osd(0, 'pve1', { usedPct: 80 }), osd(1, 'pve2', { usedPct: 80 })] }).props)
    fireEvent.click(inDrawer('Mark out'))
    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok'))
    fireEvent.change(screen.getByLabelText(en.cephCockpit.osd.confirm.typeLabel), { target: { value: 'osd.1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark out anyway' }))

    await waitFor(() => expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'refused'))
    expect(bodyOf(posts('/ceph/osd/1')[0])).toEqual({ action: 'out', force: false })
    expect(screen.getByLabelText(en.cephCockpit.osd.confirm.typeLabel)).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Mark out anyway' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Mark out anyway' }))
    expect(posts('/ceph/osd/1')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText(en.cephCockpit.osd.confirm.typeLabel), { target: { value: 'osd.1' } })
    expect(screen.getByRole('button', { name: 'Mark out anyway' })).toBeEnabled()
  })
})

describe('OsdTab latency curves', () => {
  const rowOf = (id: number) => screen.getAllByTestId('osd-row').find(r => r.getAttribute('data-osd') === String(id)) as HTMLElement

  it('Enterprise: asks the history for the OSDs of the page and draws their curve under the current value', async () => {
    handlers = [url => (url.includes('/history') ? jsonRes({ data: { points: [], slowest_osds: [], osd_series: { 0: [{ time: 1, avg_ms: 2, max_ms: 3 }, { time: 2, avg_ms: 4, max_ms: 6 }] } } }) : undefined)]
    // The SWR cache is global: a connection of its own keeps the 404 of the other tests out of this one.
    renderTab({ ...propsOf().props, conn: 'c-curves' } as CockpitTabProps)

    await waitFor(() => expect(within(rowOf(0)).getByTestId('osd-trend')).toBeTruthy())
    expect(within(rowOf(0)).getByText('1.5 ms')).toBeTruthy()
    expect(within(rowOf(1)).getByTestId('osd-trend-collecting')).toBeTruthy()
    const call = fetchMock.mock.calls.map(([u]) => String(u)).find(u => u.includes('/history')) as string

    expect(call).toContain('range=1h')
    expect(call).toContain('osds=0,1,2,3')
  })

  it('Community: no history call, "collecting" until the session buffer holds 2 points, then a session curve', async () => {
    const community = { ...propsOf().props, enterprise: false } as CockpitTabProps
    const view = renderTab(community)

    expect(within(rowOf(0)).getByTestId('osd-trend-collecting')).toBeTruthy()
    view.rerenderTab({ ...community, latencyBuffer: { 0: [{ time: 1, avg: 2, max: 2 }, { time: 2, avg: 3, max: 3 }] } } as CockpitTabProps)
    expect(within(rowOf(0)).getByTestId('osd-trend').getAttribute('aria-label')).toContain('since this page was opened')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/history'))).toBe(false)
  })

  it('Community: leaving the OSD tab and coming back keeps the points the cockpit buffer holds', () => {
    const buffer = { 0: [{ time: 1, avg: 2, max: 2 }, { time: 2, avg: 3, max: 3 }] }
    const props = { ...propsOf({ buffer }).props, enterprise: false } as CockpitTabProps

    renderTab(props).unmount()
    renderTab(props)
    expect(within(rowOf(0)).getByTestId('osd-trend')).toBeTruthy()
  })

  it('a down OSD shows no curve', () => {
    renderTab(propsOf({ list: [osd(0, 'pve1', { up: false, status: 'down' })] }).props)
    expect(within(rowOf(0)).queryByTestId('osd-trend')).toBeNull()
    expect(within(rowOf(0)).queryByTestId('osd-trend-collecting')).toBeNull()
  })
})

describe('OsdTab IOPS and throughput columns', () => {
  const grouped = (nodes: Record<string, boolean>, reasons: Record<string, string> = {}): Handler => url => {
    if (!url.includes('/ceph/exporter?nodes=')) return undefined

    const asked = decodeURIComponent(url.split('nodes=')[1]).split(',')

    return jsonRes({ data: { at: 1000, nodes: Object.fromEntries(asked.map(n => [n, nodes[n] === true ? { ok: true } : { ok: false, ...(reasons[n] ? { reason: reasons[n] } : {}) }])), osds: Object.fromEntries(SMALL.filter(o => asked.includes(o.host) && nodes[o.host]).map(o => [o.id, { node: o.host, op_r: 1, op_w: 1, op_r_out_bytes: 1, op_w_in_bytes: 1 }])) } })
  }
  const exporterUrls = () => fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.includes('/ceph/exporter'))

  it('adds the IOPS and throughput columns before the PG column, with a header each', () => {
    renderTab(propsOf().props)
    const heads = within(screen.getByTestId('osd-table')).getAllByRole('columnheader').map(h => h.textContent)

    expect(heads.slice(0, 8)).toEqual(['OSD', 'State', 'Class', 'Fill', 'Latency', 'IOPS', 'Throughput', 'PGs'])
  })

  it('reads the grouped exporter route once for the nodes of the rows shown, and fills the columns of each state', async () => {
    handlers = [grouped({ pve1: true, pve2: false, pve3: true })]
    renderTab(propsOf().props)

    await waitFor(() => expect(screen.getAllByTestId('osd-io-absent')).toHaveLength(2))
    expect(exporterUrls()).toEqual(['/api/v1/connections/c1/ceph/exporter?nodes=pve1,pve2,pve3'])
    // Two kinds of cell per OSD: osd.1 (pve2) has no exporter, the other three wait for a second reading.
    expect(within(screen.getAllByTestId('osd-row')[1]).getAllByTestId('osd-io-absent')).toHaveLength(2)
    expect(within(screen.getAllByTestId('osd-row')[0]).getAllByTestId('osd-io-measuring')).toHaveLength(2)
  })

  it('the dashes of a node that is down say why, naming the node of the row', async () => {
    handlers = [grouped({ pve1: true, pve2: false, pve3: true }, { pve2: 'timeout' })]
    renderTab(propsOf().props)

    await waitFor(() => expect(screen.getAllByTestId('osd-io-absent')).toHaveLength(2))
    const cells = within(screen.getAllByTestId('osd-row')[1]).getAllByTestId('osd-io-absent')

    for (const cell of cells) expect(cell.getAttribute('aria-label')).toMatch(/^pve2 does not answer on port \d+: open this port/)
  })

  it('a host that matches no Proxmox node has dashes and no exporter call for it', async () => {
    handlers = [grouped({ pve1: true })]
    renderTab(propsOf({ list: [osd(0, 'pve1'), osd(1, 'ghost')], nodes: ['pve1'] }).props)

    await waitFor(() => expect(screen.getAllByTestId('osd-io-measuring').length).toBeGreaterThan(0))
    expect(exporterUrls()).toEqual(['/api/v1/connections/c1/ceph/exporter?nodes=pve1'])
    // Groups are sorted by host: ghost comes first.
    expect(within(screen.getAllByTestId('osd-row')[0]).getAllByTestId('osd-io-absent')).toHaveLength(2)
  })

  it('asks only for the nodes of the page (20 rows), not of the whole cluster', async () => {
    handlers = [grouped({ pve1: true, pve2: true, pve3: true })]
    const list = Array.from({ length: 25 }, (_, i) => osd(i, i < 20 ? 'pve1' : 'pve2'))

    renderTab(propsOf({ list, nodes: ['pve1', 'pve2'] }).props)
    await waitFor(() => expect(exporterUrls().length).toBeGreaterThan(0))
    expect(exporterUrls()).toEqual(['/api/v1/connections/c1/ceph/exporter?nodes=pve1'])
  })
})
