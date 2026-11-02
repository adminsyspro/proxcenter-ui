import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import en from '@/messages/en.json'
import type { CephInventory, CockpitItem } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import ServicesTab from './ServicesTab'
import { FILL_COLUMN, lgStyle } from './fillTestUtils'

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
let permissions: string[] = ['storage.admin']

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))
vi.mock('@/contexts/RBACContext', () => ({ useRBAC: () => ({ hasPermission: (p: string) => permissions.includes(p) }) }))

const theme = createTheme()

const mon = (name: string, over: Record<string, unknown> = {}) => ({
  name, host: name, addr: `10.0.0.${name.slice(-1)}:6789/0`, rank: Number(name.slice(-1)) - 1, inQuorum: true, leader: name === 'pve1', version: '20.2.4', storeStats: null, ...over,
})
const mgr = (name: string, over: Record<string, unknown> = {}) => ({ name, host: name, version: '20.2.4', addr: `10.0.0.${name.slice(-1)}`, ...over })

interface Over {
  mons?: ReturnType<typeof mon>[]
  active?: ReturnType<typeof mgr> | null
  standbys?: ReturnType<typeof mgr>[]
  stopped?: ReturnType<typeof mgr>[]
  mds?: Record<string, unknown>[]
  osds?: Record<string, unknown>[]
  nodes?: string[]
  item?: CockpitItem | null
}

function propsOf(over: Over = {}) {
  const set = vi.fn()
  const reload = vi.fn()
  const inv = {
    hasCeph: true,
    pveNodes: over.nodes ?? ['pve1', 'pve2', 'pve3'],
    osds: { total: 0, up: 0, in: 0, down: 0, out: 0, list: over.osds ?? [] },
    monitors: { total: 3, inQuorum: 3, quorumNames: [], list: over.mons ?? [mon('pve1'), mon('pve2'), mon('pve3')] },
    managers: { active: over.active === undefined ? mgr('pve1') : over.active, standbys: over.standbys ?? [mgr('pve2'), mgr('pve3')], stopped: over.stopped },
    mds: { total: (over.mds ?? []).length, list: over.mds ?? [] },
  } as unknown as CephInventory
  const props = {
    conn: 'c1',
    live: { live: null, buffer: [], error: null, lastOkAt: 1, absent: false, stale: false, refresh: vi.fn() },
    inventory: { inventory: inv, absent: false, error: null, lastOkAt: 1, stale: false, reload },
    url: { conn: 'c1', tab: 'services', item: over.item ?? null, filter: 'all', range: 'live', hosts: 'all', set },
    enterprise: true,
    ratios: { nearfull: 0.85, full: 0.95 },
    focus: null,
    osdFlags: {},
    latencyBuffer: {},
    onNavigate: vi.fn(),
  } as unknown as CockpitTabProps

  return { props, set, reload }
}

function renderTab(props: CockpitTabProps) {
  return render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={theme}>
        <ServicesTab {...props} />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )
}

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const posts = () => fetchMock.mock.calls.map(([url, init]) => [String(url), JSON.parse(String((init as RequestInit)?.body))])
const row = (service: string) => document.querySelector(`[data-service="${service}"]`) as HTMLElement

beforeEach(() => {
  permissions = ['storage.admin']
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(json({ data: { upid: 'UPID:pve1:1' } }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('ServicesTab', () => {
  it('below lg: the ServicesTab has no fill style, natural flow', () => {
    renderTab(propsOf().props)

    const root = screen.getByTestId('services-tab')

    expect(root).not.toHaveStyle({ flexGrow: '1' })
    expect(root).not.toHaveStyle({ minHeight: '0px' })
  })

  it('wide: the daemons card goes down to the bottom, the versions strip keeps its height', () => {
    renderTab(propsOf().props)

    expect(lgStyle(screen.getByTestId('services-tab'))).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('services-card'))).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('services-table'))).toMatchObject({ flex: '1 1 auto', 'min-height': '0px' })
    expect(lgStyle(screen.getByTestId('services-versions'))).not.toHaveProperty('flex')
  })

  it('groups monitors, managers and metadata servers with host, state, role, address and version', () => {
    renderTab(propsOf({ mds: [{ name: 'pve1', host: 'pve1', addr: '10.0.0.1:6801/1', state: 'up:active', rank: 0, version: '20.2.4' }] }).props)
    expect(screen.getByTestId('service-group-mon')).toHaveTextContent('Monitors')
    expect(screen.getByTestId('service-group-mon')).toHaveTextContent('3 of 3 in quorum')
    expect(screen.getByTestId('service-group-mgr')).toHaveTextContent('1 active, 2 on standby')
    expect(screen.getByTestId('service-group-mds')).toHaveTextContent('Metadata servers (CephFS)')
    const mon2 = row('mon.pve2')

    expect(within(mon2).getByTestId('service-host')).toHaveTextContent('pve2')
    expect(within(within(mon2).getByTestId('service-host')).getByRole('presentation', { hidden: true })).toHaveAttribute('src', expect.stringContaining('proxmox-logo'))
    expect(within(mon2).getByTestId('service-state')).toHaveTextContent('In quorum')
    expect(mon2).toHaveTextContent('10.0.0.2:6789')
    expect(mon2).not.toHaveTextContent('/0')
    expect(within(mon2).getByTestId('service-version')).toHaveTextContent('20.2.4')
    expect(within(row('mgr.pve2')).getByTestId('service-state')).toHaveTextContent('Standby')
    expect(within(row('mds.pve1')).getByTestId('service-state')).toHaveTextContent('Active')
    expect(row('mds.pve1')).toHaveTextContent('rank 0')
  })

  it('leader role shown on quorum leader', () => {
    renderTab(propsOf().props)
    expect(row('mon.pve1')).toHaveTextContent('leader')
    expect(row('mon.pve2')).toHaveTextContent('peon')
    expect(row('mon.pve2')).not.toHaveTextContent('leader')
  })

  it('a stopped monitor has no role (no peon)', () => {
    renderTab(propsOf({ mons: [mon('pve1'), mon('pve2', { inQuorum: false, state: 'stopped' })] }).props)
    expect(within(row('mon.pve2')).getByTestId('service-state')).toHaveTextContent('Stopped')
    expect(row('mon.pve2')).not.toHaveTextContent('peon')
  })

  it('lists the daemons of a kind by name, whatever the order PVE gave', () => {
    renderTab(propsOf({ mons: [mon('pve3'), mon('pve1'), mon('pve2')] }).props)
    expect(screen.getAllByTestId('service-row').slice(0, 3).map(r => r.getAttribute('data-service'))).toEqual(['mon.pve1', 'mon.pve2', 'mon.pve3'])
  })

  it('flags a monitor out of quorum', () => {
    renderTab(propsOf({ mons: [mon('pve1'), mon('pve2', { inQuorum: false }), mon('pve3')] }).props)
    expect(row('mon.pve2')).toHaveAttribute('data-state', 'warn')
    expect(within(row('mon.pve2')).getByTestId('service-state')).toHaveTextContent('Out of quorum')
    expect(screen.getByTestId('service-group-mon')).toHaveTextContent('2 of 3 in quorum')
  })

  it('mixed versions banner when two versions', () => {
    renderTab(propsOf({ standbys: [mgr('pve2'), mgr('pve3', { version: '19.2.1' })] }).props)
    expect(screen.getByTestId('services-mixed')).toBeInTheDocument()
    expect(screen.getByText('Mixed versions')).toBeInTheDocument()
    const items = screen.getAllByTestId('services-version').map(e => e.textContent)

    expect(items).toEqual(['20.2.4 on 5 daemons', '19.2.1 on 1 daemon'])
  })

  it('counts the OSDs in service in the versions, and ignores the daemons that are down', () => {
    renderTab(propsOf({
      osds: [{ id: 0, up: true, version: '19.2.1' }, { id: 1, up: true, version: '20.2.4' }, { id: 2, up: false, version: '17.2.0' }],
    }).props)
    expect(screen.getAllByTestId('services-version').map(e => e.textContent)).toEqual(['20.2.4 on 7 daemons', '19.2.1 on 1 daemon'])
  })

  it('does not read the long version string as a second version', () => {
    renderTab(propsOf({ standbys: [mgr('pve2', { version: 'ceph version 20.2.4 (a12e197e) tentacle (stable)' }), mgr('pve3')] }).props)
    expect(screen.queryByTestId('services-mixed')).not.toBeInTheDocument()
    expect(within(row('mgr.pve2')).getByTestId('service-version')).toHaveTextContent(/^20\.2\.4$/)
    expect(screen.getAllByTestId('services-version').map(e => e.textContent)).toEqual(['20.2.4 on 6 daemons'])
  })

  it('shows two releases with their counts as mixed', () => {
    renderTab(propsOf({ standbys: [mgr('pve2', { version: '20.2.5' }), mgr('pve3')] }).props)
    expect(screen.getByTestId('services-mixed')).toBeInTheDocument()
    expect(screen.getAllByTestId('services-version').map(e => e.textContent)).toEqual(['20.2.4 on 5 daemons', '20.2.5 on 1 daemon'])
  })

  it('ignores an unreadable version in the comparison and shows a dash', () => {
    renderTab(propsOf({ standbys: [mgr('pve2', { version: 'garbage' }), mgr('pve3')] }).props)
    expect(screen.queryByTestId('services-mixed')).not.toBeInTheDocument()
    expect(within(row('mgr.pve2')).getByTestId('service-version')).toHaveTextContent('–')
    expect(screen.getAllByTestId('services-version').map(e => e.textContent)).toEqual(['20.2.4 on 5 daemons'])
  })

  it('no banner with one version', () => {
    renderTab(propsOf().props)
    expect(screen.queryByTestId('services-mixed')).not.toBeInTheDocument()
    expect(screen.getByText('Ceph versions')).toBeInTheDocument()
    expect(screen.getAllByTestId('services-version').map(e => e.textContent)).toEqual(['20.2.4 on 6 daemons'])
  })

  it('says so when no daemon reports a version, and does not count it as a second version', () => {
    renderTab(propsOf({ mons: [mon('pve1', { version: null })], standbys: [], active: mgr('pve1', { version: '20.2.4' }) }).props)
    expect(screen.queryByTestId('services-mixed')).not.toBeInTheDocument()
    expect(within(row('mon.pve1')).getByTestId('service-version')).toHaveTextContent('–')
  })

  it('shows the empty metadata group when the cluster has no CephFS', () => {
    renderTab(propsOf().props)
    expect(screen.getByTestId('service-group-mds')).toHaveTextContent('none')
    expect(screen.getByText('No CephFS on this cluster, so no metadata server')).toBeInTheDocument()
  })

  it('actions delegate to CephServiceActions with service name', async () => {
    renderTab(propsOf().props)
    fireEvent.click(within(row('mon.pve2')).getByRole('button', { name: 'Stop mon.pve2' }))
    expect(await screen.findByText('mon.pve2 will be stopped on pve2.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(posts()[0]).toEqual(['/api/v1/connections/c1/nodes/pve2/ceph/service', { action: 'stop', service: 'mon.pve2', force: false }])
  })

  it('targets the PVE node the host resolves to when the daemon host is an FQDN', async () => {
    renderTab(propsOf({ mons: [mon('pve1', { host: 'pve1.lab.local' })] }).props)
    fireEvent.click(within(row('mon.pve1')).getByRole('button', { name: 'Restart mon.pve1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(posts()[0][0]).toBe('/api/v1/connections/c1/nodes/pve1/ceph/service')
  })

  it('disables the actions, with the reason, when the host matches no PVE node', () => {
    renderTab(propsOf({ mons: [mon('pve1', { host: 'ghost' })] }).props)
    const buttons = within(row('mon.pve1')).getAllByRole('button').filter(b => !b.getAttribute('aria-label')?.startsWith('Highlight'))

    expect(buttons).toHaveLength(3)
    for (const b of buttons) {
      expect(b).toBeDisabled()
      expect(b).toHaveAccessibleName('No PVE node matches the host ghost: actions are unavailable')
    }
  })

  it('disables the actions without storage.admin', () => {
    permissions = []
    renderTab(propsOf().props)
    expect(within(row('mon.pve2')).getByRole('button', { name: 'Stop mon.pve2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create a daemon' })).toBeDisabled()
  })

  async function startRestart() {
    fireEvent.click(within(row('mon.pve2')).getByRole('button', { name: 'Restart mon.pve2' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  }

  it('re-reads the inventory 5, 20 and 45 seconds after a task started, and not again after', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, reload } = propsOf()

    renderTab(props)
    await startRestart()
    expect(reload).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(4900) })
    expect(reload).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(200) })
    expect(reload).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(14_800) })
    expect(reload).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(300) })
    expect(reload).toHaveBeenCalledTimes(2)
    act(() => { vi.advanceTimersByTime(24_400) })
    expect(reload).toHaveBeenCalledTimes(2)
    act(() => { vi.advanceTimersByTime(700) })
    expect(reload).toHaveBeenCalledTimes(3)
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('starts the follow-up reads again from a second action instead of stacking them', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, reload } = propsOf()

    renderTab(props)
    await startRestart()
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(reload).toHaveBeenCalledTimes(2)
    toast.success.mockClear()
    await startRestart()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(reload).toHaveBeenCalledTimes(5)
  })

  it('cancels the follow-up reads when the tab goes away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, reload } = propsOf()
    const view = renderTab(props)

    await startRestart()
    view.unmount()
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(reload).not.toHaveBeenCalled()
  })

  it('cancels the follow-up reads when the connection changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, reload } = propsOf()
    const view = renderTab(props)

    await startRestart()
    view.rerender(
      <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
        <ThemeProvider theme={theme}>
          <ServicesTab {...props} conn='c2' />
        </ThemeProvider>
      </NextIntlClientProvider>,
    )
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(reload).not.toHaveBeenCalled()
  })

  it('lists a stopped manager as Stopped with Start available and Stop off, and counts it in the group summary', () => {
    renderTab(propsOf({ standbys: [mgr('pve2')], stopped: [mgr('pve3', { version: null, addr: null })] }).props)
    const stopped = row('mgr.pve3')

    expect(within(stopped).getByTestId('service-state')).toHaveTextContent('Stopped')
    expect(stopped).toHaveAttribute('data-state', 'warn')
    expect(within(stopped).getByRole('button', { name: 'Start mgr.pve3' })).toBeEnabled()
    expect(within(stopped).getByRole('button', { name: 'Stop mgr.pve3' })).toBeDisabled()
    expect(within(stopped).getByRole('button', { name: 'Restart mgr.pve3' })).toBeDisabled()
    expect(screen.getByTestId('service-group-mgr')).toHaveTextContent('1 active, 1 on standby, 1 stopped')
    expect(within(row('mgr.pve2')).getByRole('button', { name: 'Start mgr.pve2' })).toBeDisabled()
  })

  it('starts a stopped manager through the node and re-reads afterwards', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, reload } = propsOf({ standbys: [mgr('pve2')], stopped: [mgr('pve3', { version: null, addr: null })] })

    renderTab(props)
    fireEvent.click(within(row('mgr.pve3')).getByRole('button', { name: 'Start mgr.pve3' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(posts()[0][0]).toContain('/nodes/pve3/')
    act(() => { vi.advanceTimersByTime(46_000) })
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('keeps the plain summary when no manager is stopped', () => {
    renderTab(propsOf({ stopped: [] }).props)
    expect(screen.getByTestId('service-group-mgr')).toHaveTextContent(/^.*1 active, 2 on standby$/)
  })

  it('highlights the row of item=svc:<name> and toggles it on click', () => {
    const { props, set } = propsOf({ item: { kind: 'service', name: 'mgr.pve2' } })

    renderTab(props)
    expect(row('mgr.pve2')).toHaveAttribute('aria-current', 'true')
    expect(row('mon.pve1')).not.toHaveAttribute('aria-current')
    fireEvent.click(within(row('mgr.pve2')).getByRole('button', { name: 'Highlight mgr.pve2' }))
    expect(set).toHaveBeenCalledWith({ item: null })
    fireEvent.click(within(row('mon.pve1')).getByRole('button', { name: 'Highlight mon.pve1' }))
    expect(set).toHaveBeenCalledWith({ item: { kind: 'service', name: 'mon.pve1' } })
  })

  it('creates a daemon on a node that does not run one yet', async () => {
    renderTab(propsOf({ mons: [mon('pve1'), mon('pve2')], nodes: ['pve1', 'pve2', 'pve3'] }).props)
    fireEvent.click(screen.getByRole('button', { name: 'Create a daemon' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByRole('combobox', { name: 'Node' })).toHaveTextContent('pve3')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }))
    const create = await screen.findByText('Create monitor on pve3')

    expect(create).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(posts()[0]).toEqual(['/api/v1/connections/c1/nodes/pve3/ceph/create', { kind: 'mon' }])
  })

  it('disables the creation when every node already runs a monitor and a manager', () => {
    renderTab(propsOf().props)
    expect(screen.getByRole('button', { name: 'Create a daemon' })).toBeDisabled()
  })

  it('paginates beyond 20 rows', () => {
    const mons = Array.from({ length: 25 }, (_, i) => mon(`pve${i + 1}`))
    const nodes = mons.map(m => m.name)

    renderTab(propsOf({ mons, active: null, standbys: [], nodes }).props)
    expect(screen.getAllByTestId('service-row')).toHaveLength(20)
    expect(screen.getByTestId('services-pager')).toHaveTextContent('1 to 20 of 25')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getAllByTestId('service-row')).toHaveLength(5)
  })

  it('follows a selected row to its page', () => {
    const mons = Array.from({ length: 25 }, (_, i) => mon(`pve${i + 1}`))

    renderTab(propsOf({ mons, active: null, standbys: [], nodes: mons.map(m => m.name), item: { kind: 'service', name: 'mon.pve24' } }).props)
    expect(row('mon.pve24')).toHaveAttribute('aria-current', 'true')
  })

  it('shows a skeleton until the inventory is there', () => {
    const { props } = propsOf()

    renderTab({ ...props, inventory: { ...props.inventory, inventory: null } })
    expect(screen.getByTestId('services-loading')).toBeInTheDocument()
  })
})
