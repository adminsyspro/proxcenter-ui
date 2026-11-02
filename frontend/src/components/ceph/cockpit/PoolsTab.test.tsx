import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import en from '@/messages/en.json'
import type { CephInventory, CockpitItem } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import PoolsTab from './PoolsTab'
import { FILL_COLUMN, lgStyle } from './fillTestUtils'

let storagesState: { storages: Record<string, string[]> | null; loading: boolean; error: Error | null } = { storages: {}, loading: false, error: null }

vi.mock('./hooks/useCephPoolStorages', () => ({ useCephPoolStorages: () => storagesState }))

const theme = createTheme()
const GiB = 1024 ** 3

const pool = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, size: 3, minSize: 2, pgNum: 128, pgNumTarget: 128, type: 'replicated', application: 'rbd', crushRule: 0, crushRuleName: 'replicated_rule',
  crushRootId: -1, pgAutoscaleMode: 'on', bytesUsed: 28 * GiB, maxAvail: 6 * GiB, objects: 7412, bytesUsedFormatted: '28 GiB', maxAvailFormatted: '6 GiB',
  percentUsed: 0.5, ...over,
})

const inventoryOf = (list: ReturnType<typeof pool>[]) => ({
  hasCeph: true,
  health: { status: 'HEALTH_OK', checks: [], numChecks: 0 },
  osds: { total: 0, up: 0, in: 0, down: 0, out: 0, list: [] },
  pools: { total: list.length, list },
  crushTree: [],
  crushRules: [{ id: 0, name: 'replicated_rule', steps: [] }],
}) as unknown as CephInventory

function propsOf(list: ReturnType<typeof pool>[], item: CockpitItem | null = null) {
  const set = vi.fn()
  const onNavigate = vi.fn()
  const props = {
    conn: 'c1',
    live: { live: null, buffer: [], error: null, lastOkAt: 1, absent: false, stale: false, refresh: vi.fn() },
    inventory: { inventory: inventoryOf(list), absent: false, error: null, lastOkAt: 1, stale: false, reload: vi.fn() },
    url: { conn: 'c1', tab: 'pools', item, filter: 'all', range: 'live', hosts: 'all', set },
    enterprise: true,
    ratios: { nearfull: 0.85, full: 0.95 },
    focus: null,
    osdFlags: {},
    latencyBuffer: {},
    onNavigate,
  } as unknown as CockpitTabProps

  return { props, set, onNavigate }
}

const renderTab = (props: CockpitTabProps) => render(
  <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
    <ThemeProvider theme={theme}>
      <PoolsTab {...props} />
    </ThemeProvider>
  </NextIntlClientProvider>,
)

beforeEach(() => { storagesState = { storages: { 'ceph-vm': ['ceph-vm'] }, loading: false, error: null } })
afterEach(cleanup)

describe('PoolsTab table', () => {
  it('below lg: the PoolsTab has no fill style, natural flow', () => {
    renderTab(propsOf([pool(1, '.mgr')]).props)

    const root = screen.getByTestId('pools-tab')

    expect(root).not.toHaveStyle({ flexGrow: '1' })
    expect(root).not.toHaveStyle({ minHeight: '0px' })
  })

  it('wide: the table card goes down to the bottom and the pager stays at its foot', () => {
    renderTab(propsOf([pool(1, '.mgr')]).props)

    expect(lgStyle(screen.getByTestId('pools-tab'))).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('pools-card'))).toMatchObject(FILL_COLUMN)
    expect(lgStyle(screen.getByTestId('pools-table'))).toMatchObject({ flex: '1 1 auto', 'min-height': '0px' })
  })

  it('lists the pools, the fullest first, with the figures of the row', () => {
    renderTab(propsOf([pool(1, '.mgr', { percentUsed: 0.0001, application: 'mgr' }), pool(2, 'ceph-vm', { percentUsed: 0.88 })]).props)

    const rows = screen.getAllByTestId('pool-row')

    expect(rows.map(r => r.getAttribute('data-pool'))).toEqual(['ceph-vm', '.mgr'])
    expect(rows[0]).toHaveTextContent('Replica 3 / min 2')
    expect(rows[0]).toHaveTextContent('128')
    expect(rows[0]).toHaveTextContent('auto on')
    expect(rows[0]).toHaveTextContent('7,412')
    expect(rows[0]).toHaveTextContent('88%')
    expect(rows[0]).toHaveTextContent('ceph-vm')
  })

  it('a click opens the pool through the URL', () => {
    const { props, set } = propsOf([pool(2, 'ceph-vm')])

    renderTab(props)
    fireEvent.click(screen.getByTestId('pool-row'))
    expect(set).toHaveBeenCalledWith({ item: { kind: 'pool', name: 'ceph-vm' } })
  })

  it('rule cell links to crush tab', () => {
    const { props, onNavigate, set } = propsOf([pool(2, 'ceph-vm')])

    renderTab(props)
    fireEvent.click(within(screen.getByTestId('pool-row')).getByRole('button', { name: /replicated_rule/ }))
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'crush' })
    expect(set).not.toHaveBeenCalled()
  })

  it('names the rule from the inventory rules when the pool carries no name', () => {
    renderTab(propsOf([pool(2, 'ceph-vm', { crushRuleName: null })]).props)
    expect(within(screen.getByTestId('pool-row')).getByRole('button', { name: /replicated_rule/ })).toBeInTheDocument()
  })

  it('no write action rendered', () => {
    renderTab(propsOf([pool(2, 'ceph-vm')], { kind: 'pool', name: 'ceph-vm' }).props)

    const labels = screen.queryAllByRole('button').map(b => `${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).join('|')

    expect(labels).not.toMatch(/create|delete|edit|modify|remove|add|resize/i)
  })

  it('pool over nearfull shows warning tone', () => {
    renderTab(propsOf([pool(2, 'ceph-vm', { percentUsed: 0.88 }), pool(3, 'ok', { percentUsed: 0.3 })]).props)

    const [hot, calm] = screen.getAllByTestId('pool-row')

    expect(hot).toHaveAttribute('data-state', 'warn')
    expect(within(hot).getByTestId('threshold-fill')).toHaveAttribute('data-tone', 'warn')
    expect(calm).toHaveAttribute('data-state', 'ok')
  })

  it('a pool over full is an error and a demo percentage is read as a percentage', () => {
    renderTab(propsOf([pool(2, 'big', { percentUsed: 97 })]).props)
    expect(screen.getByTestId('pool-row')).toHaveAttribute('data-state', 'error')
  })

  it('shows the PVE storage of the pool, a dash when none', () => {
    renderTab(propsOf([pool(2, 'ceph-vm'), pool(3, 'other', { percentUsed: 0.1 })]).props)

    const [a, b] = screen.getAllByTestId('pool-row')

    expect(a).toHaveTextContent('ceph-vm')
    expect(within(b).getByTestId('pool-storage')).toHaveTextContent(en.cephCockpit.overview.missing)
  })

  it('net available is a dash when the route does not report it, even on an empty pool', () => {
    renderTab(propsOf([pool(2, 'empty', { bytesUsed: 0, maxAvail: 0, percentUsed: 0, objects: 0 })]).props)

    const cells = within(screen.getByTestId('pool-row')).getAllByRole('cell')

    expect(cells[7]).toHaveTextContent(en.cephCockpit.overview.missing)
    expect(cells[8]).toHaveTextContent('0')
  })

  it('pages beyond 20 pools', () => {
    const list = Array.from({ length: 25 }, (_, i) => pool(i, `p${String(i).padStart(2, '0')}`, { percentUsed: 0.1 }))

    renderTab(propsOf(list).props)
    expect(screen.getAllByTestId('pool-row')).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.pools.pager.next }))
    expect(screen.getAllByTestId('pool-row')).toHaveLength(5)
  })

  it('shows the empty state without pool and a skeleton while loading', () => {
    const { props } = propsOf([])

    renderTab(props)
    expect(screen.getByText(en.cephCockpit.pools.empty)).toBeInTheDocument()
    cleanup()
    renderTab({ ...props, inventory: { ...props.inventory, inventory: null } })
    expect(screen.getByTestId('pools-loading')).toBeInTheDocument()
  })
})

describe('PoolDrawer', () => {
  const open = (over: Record<string, unknown> = {}, list = [pool(2, 'ceph-vm', over), pool(3, 'other', { percentUsed: 0.1 })]) => {
    const view = propsOf(list, { kind: 'pool', name: 'ceph-vm' })

    renderTab(view.props)

    return { ...view, drawer: screen.getByTestId('pool-drawer') }
  }

  it('opens as a centered dialog named by the pool, not a side drawer', () => {
    const { drawer } = open()

    expect(screen.getByRole('dialog', { name: 'ceph-vm' })).toBe(drawer)
    expect(document.querySelector('.MuiDrawer-root')).toBeNull()
    expect(drawer.closest('.MuiDialog-root')).not.toBeNull()
  })

  it('the truncated subtitle carries its full text as a native tooltip', () => {
    const { drawer } = open()

    expect(within(drawer).getByTitle('rbd \u00b7 replicated')).toBeTruthy()
  })

  it('Escape clears the item', () => {
    const { set } = open()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(set).toHaveBeenCalledWith({ item: null })
  })

  it('the previous and next buttons move to the neighbour pool', () => {
    const { set, drawer } = open()

    fireEvent.click(within(drawer).getByRole('button', { name: en.cephCockpit.pools.drawer.next }))
    expect(set).toHaveBeenLastCalledWith({ item: { kind: 'pool', name: 'other' } })
  })

  it('shows the target PG count, the autoscale mode and the PVE storage', () => {
    const { drawer } = open({ pgNum: 128, pgNumTarget: 64, pgAutoscaleMode: 'warn' })

    expect(drawer).toHaveTextContent('64 (now 128)')
    expect(drawer).toHaveTextContent('warn')
    expect(drawer).toHaveTextContent('ceph-vm')
    expect(drawer).toHaveTextContent('Replica 3 / min 2')
  })

  it('quota row only when quota set', () => {
    const none = open()

    expect(within(none.drawer).queryByText(en.cephCockpit.pools.drawer.quotaBytes)).toBeNull()
    expect(within(none.drawer).queryByText(en.cephCockpit.pools.drawer.quotaObjects)).toBeNull()
    cleanup()

    const set = open({ quotaBytes: 100 * GiB, quotaObjects: 5000 })

    expect(within(set.drawer).getByText(en.cephCockpit.pools.drawer.quotaBytes)).toBeInTheDocument()
    expect(within(set.drawer).getByText(en.cephCockpit.pools.drawer.quotaObjects)).toBeInTheDocument()
    expect(set.drawer).toHaveTextContent('100 GiB')
  })

  it('the arrows walk the table and the close button clears the item', () => {
    const { set, drawer } = open()

    fireEvent.click(within(drawer).getByRole('button', { name: en.cephCockpit.pools.drawer.next }))
    expect(set).toHaveBeenCalledWith({ item: { kind: 'pool', name: 'other' } })
    fireEvent.click(within(drawer).getByRole('button', { name: en.cephCockpit.pools.drawer.close }))
    expect(set).toHaveBeenCalledWith({ item: null })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(set).toHaveBeenCalledTimes(3)
  })

  it('the rule link of the drawer leads to the CRUSH tab', () => {
    const { onNavigate, drawer } = open()

    fireEvent.click(within(drawer).getByRole('button', { name: /replicated_rule/ }))
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'crush' })
  })

  it('the drawer tells loading, failure and an empty answer apart', () => {
    storagesState = { storages: null, loading: true, error: null }
    open()
    expect(screen.getByTestId('pool-drawer')).not.toHaveTextContent(en.cephCockpit.pools.drawer.storagesNone)
    expect(screen.getByTestId('pool-drawer')).not.toHaveTextContent(en.cephCockpit.pools.drawer.storagesUnavailable)
    expect(screen.getAllByTestId('pool-storage-loading')[0]).toBeInTheDocument()
    cleanup()

    storagesState = { storages: null, loading: false, error: new Error('x') }
    open()
    expect(screen.getByTestId('pool-drawer')).toHaveTextContent(en.cephCockpit.pools.drawer.storagesUnavailable)
    expect(screen.getByTestId('pool-drawer')).not.toHaveTextContent(en.cephCockpit.pools.drawer.storagesNone)
    cleanup()

    storagesState = { storages: {}, loading: false, error: null }
    open()
    expect(screen.getByTestId('pool-drawer')).toHaveTextContent(en.cephCockpit.pools.drawer.storagesNone)
  })

  it('shows the autoscaler recommendation only when it differs from the PG count', () => {
    const differs = open({ pgNum: 128, pgNumTarget: 128, pgNumIdeal: 81, pgNumFinal: 64 })

    expect(differs.drawer).toHaveTextContent('64 (ideal 81)')
    cleanup()

    const same = open({ pgNum: 128, pgNumTarget: 128, pgNumIdeal: 128, pgNumFinal: 128 })

    expect(within(same.drawer).queryByText(en.cephCockpit.pools.drawer.pgRecommended)).toBeNull()
  })

  it('opens nothing for a pool the cluster does not have', () => {
    renderTab(propsOf([pool(2, 'ceph-vm')], { kind: 'pool', name: 'gone' }).props)
    expect(screen.queryByTestId('pool-drawer')).toBeNull()
  })
})
