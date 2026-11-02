import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'

import en from '@/messages/en.json'
import { parseCrushMap } from '@/lib/ceph/crushRules'
import type { CephInventory, CockpitTab } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import CrushTab from './CrushTab'
import { jsonRes } from './hooks/testHelpers'
import { lgStyle } from './fillTestUtils'

vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => true }))

const theme = createTheme()
const TiB = 1024 ** 4
const fixture = (name: string) => parseCrushMap(readFileSync(join(__dirname, '../../../lib/ceph/__fixtures__', name), 'utf8'))
const fetchMock = vi.fn()

const osd = (id: number, host: string, over: Record<string, unknown> = {}) => ({
  id, name: `osd.${id}`, host, status: 'up', up: true, in: true, deviceClass: 'hdd', totalBytes: 0.1 * TiB, usedBytes: 0, availBytes: 0,
  usedPct: 50, commitLatencyMs: 1.5, applyLatencyMs: 1.5, reweight: 1, pgs: 43, version: '20.2.4', ...over,
})

const inventoryOf = (osds: ReturnType<typeof osd>[], pools: unknown[]) => ({
  hasCeph: true,
  health: { status: 'HEALTH_OK', checks: [], numChecks: 0 },
  osds: { total: osds.length, up: osds.length, in: osds.length, down: 0, out: 0, list: osds },
  monitors: { total: 1, inQuorum: 1, quorumNames: ['pve1'], list: [{ name: 'pve1', host: 'pve1', leader: true, inQuorum: true }] },
  managers: { active: { name: 'pve1', host: 'pve1' }, standbys: [] },
  mds: { total: 0, list: [] },
  pools: { total: pools.length, list: pools },
  crushTree: [],
  crushRules: [],
  pveNodes: ['pve1', 'pve2', 'pve3'],
}) as unknown as CephInventory

const pool = (name: string, over: Record<string, unknown> = {}) => ({ id: 1, name, size: 3, minSize: 2, crushRule: 0, crushRuleName: 'replicated_rule', ...over })
const THREE = [osd(0, 'pve1'), osd(1, 'pve2'), osd(2, 'pve3')]

function propsOf(over: { tab?: CockpitTab; osds?: ReturnType<typeof osd>[]; pools?: unknown[]; hostFlags?: Record<string, string[]> } = {}) {
  const set = vi.fn()
  const props = {
    conn: 'c1',
    live: { live: null, buffer: [], error: null, lastOkAt: 1, absent: false, stale: false, refresh: vi.fn() },
    inventory: { inventory: inventoryOf(over.osds ?? THREE, over.pools ?? [pool('ceph-vm')]), absent: false, error: null, lastOkAt: 1, stale: false, reload: vi.fn() },
    url: { conn: 'c1', tab: over.tab ?? 'crush', item: null, filter: 'all', range: 'live', hosts: 'all', set },
    enterprise: true,
    ratios: { nearfull: 0.85, full: 0.95 },
    focus: null,
    osdFlags: { flags: [], hostFlags: over.hostFlags ?? {}, osdFlags: {}, loading: false, toggling: null, forbidden: false, toggle: vi.fn(), toggleHost: vi.fn() },
    onNavigate: vi.fn(),
  } as unknown as CockpitTabProps

  return { props, set }
}

function renderTab(props: CockpitTabProps) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
        <ThemeProvider theme={theme}>
          <CrushTab {...props} />
        </ThemeProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  )
}

const serve = (map: ReturnType<typeof parseCrushMap>) => fetchMock.mockResolvedValue(jsonRes(map))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CrushTab', () => {
  it('wide: the grid grows into the free height and both cards stretch to its bottom', async () => {
    serve(fixture('crushmap-3hosts.txt'))
    renderTab(propsOf().props)

    const grid = await screen.findByTestId('crush-tab')

    expect(lgStyle(grid)).toMatchObject({ flex: '1 1 auto', 'min-height': '0px', 'align-items': 'stretch' })
    expect(lgStyle(screen.getByTestId('crush-tree-card'))).toMatchObject({ flex: '1 1 auto', display: 'flex', 'flex-direction': 'column' })
    expect(lgStyle(screen.getByRole('tree'))).toMatchObject({ flex: '1 1 auto' })
  })

  it('draws host buckets with the Proxmox logo and OSDs with the disk glyph', async () => {
    serve(fixture('crushmap-3hosts.txt'))
    renderTab(propsOf().props)
    await screen.findByTestId('crush-tab')

    const host = (await screen.findAllByTestId('crush-bucket')).find(b => b.getAttribute('data-node') === 'pve1')!

    expect(host.querySelector('img')).toHaveAttribute('src', expect.stringContaining('proxmox-logo'))
    const osds = await screen.findAllByTestId('crush-osd')

    expect(osds.length).toBeGreaterThan(0)
    for (const o of osds) expect(within(o).getByTestId('osd-glyph')).toBeInTheDocument()
  })

  it('crush fetched only when tab active', async () => {
    serve(fixture('crushmap-3hosts.txt'))
    renderTab(propsOf({ tab: 'overview' }).props)
    await new Promise(r => setTimeout(r, 30))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the map once when the tab is active and draws the tree', async () => {
    serve(fixture('crushmap-3hosts.txt'))
    renderTab(propsOf().props)

    expect(await screen.findByTestId('crush-tab')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/connections/c1/ceph/crush')
    expect(screen.getAllByTestId('crush-bucket').map(r => r.getAttribute('data-node'))).toEqual(['default', 'pve1', 'pve2', 'pve3'])
    expect(screen.getAllByTestId('crush-osd')).toHaveLength(3)
  })

  it('tolerance sentence per pool', async () => {
    serve(fixture('crushmap-3hosts.txt'))
    renderTab(propsOf().props)

    const line = await screen.findByTestId('crush-tolerance')

    expect(line).toHaveAttribute('data-level', 'tolerates')
    expect(line).toHaveTextContent('ceph-vm (Replica 3 / min 2)')
    expect(line).toHaveTextContent('survives the loss of 1 host without interruption.')
    expect(within(screen.getByTestId('crush-rule')).getByText('replicated')).toBeInTheDocument()
  })

  it('says so when the tolerance cannot be computed and when the pool blocks I/O', async () => {
    serve(fixture('crushmap-3hosts.txt'))
    renderTab(propsOf({ pools: [pool('p2', { size: 3, minSize: 3 })] }).props)

    expect(await screen.findByTestId('crush-tolerance')).toHaveTextContent('I/O blocks as soon as one host is lost, until it is rebuilt.')

    cleanup()
    serve({ buckets: fixture('crushmap-3hosts.txt').buckets, types: [], rules: [{ id: 0, name: 'replicated_rule', type: 'replicated', steps: [{ op: 'take', item: 'default' }, { op: 'take', item: 'other' }, { op: 'emit' }] }] })
    renderTab(propsOf().props)

    const line = await screen.findByTestId('crush-tolerance')

    expect(line).toHaveAttribute('data-level', 'unknown')
    expect(line).toHaveTextContent('Tolerance cannot be computed for this rule.')
  })

  it('writes the rule steps in plain words and lists the pools of the rule', async () => {
    serve(fixture('crushmap-ssd.txt'))
    const { props, set } = propsOf({ pools: [pool('fast', { crushRuleName: 'ssd_rule', crushRule: 1 })] })

    renderTab(props)

    const rule = await screen.findByTestId('crush-rule')

    expect(within(rule).getByTestId('crush-step-take')).toHaveTextContent('take default, class ssd')
    expect(within(rule).getByTestId('crush-step-chooseleaf_firstn')).toHaveTextContent('choose one host per replica, then an OSD in each')
    expect(within(rule).getByTestId('crush-step-emit')).toHaveTextContent('emit')
    expect(within(rule).getByText('class ssd')).toBeInTheDocument()

    fireEvent.click(within(rule).getByRole('button', { name: 'Open pool fast' }))
    expect(set).toHaveBeenCalledWith({ tab: 'pools', item: { kind: 'pool', name: 'fast' } })
  })

  it('class filter hides non matching osds', async () => {
    serve(fixture('crushmap-3hosts.txt'))
    renderTab(propsOf({ osds: [osd(0, 'pve1'), osd(1, 'pve2', { deviceClass: 'ssd' }), osd(2, 'pve3')] }).props)

    await screen.findByTestId('crush-tab')
    expect(screen.getAllByTestId('crush-osd')).toHaveLength(3)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Class' }))
    fireEvent.click(await screen.findByRole('option', { name: 'SSD' }))

    await waitFor(() => expect(screen.getAllByTestId('crush-osd')).toHaveLength(1))
    expect(screen.getByTestId('crush-osd')).toHaveAttribute('data-node', 'osd.1')
    expect(screen.getAllByTestId('crush-bucket').map(r => r.getAttribute('data-node'))).toEqual(['default', 'pve2'])
  })

  it('osd click opens osd tab', async () => {
    serve(fixture('crushmap-3hosts.txt'))
    const { props, set } = propsOf()

    renderTab(props)
    fireEvent.click(await screen.findByRole('treeitem', { name: 'Open osd.1' }))

    expect(set).toHaveBeenCalledWith({ tab: 'osd', item: { kind: 'osd', id: 1 } })
  })

  it('folds and unfolds a bucket, and shows the host flags and daemons', async () => {
    serve(fixture('crushmap-3hosts.txt'))
    renderTab(propsOf({ hostFlags: { pve2: ['noout'] } }).props)

    const host = await screen.findAllByTestId('crush-bucket').then(rows => rows.find(r => r.getAttribute('data-node') === 'pve2')!)

    expect(host).toHaveTextContent('noout')
    expect(screen.getAllByTestId('crush-osd')).toHaveLength(3)
    expect(within(screen.getAllByTestId('crush-bucket')[1]).getByText('mon ★')).toBeInTheDocument()

    fireEvent.click(host)
    expect(screen.getAllByTestId('crush-osd')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Unfold all' }))
    expect(screen.getAllByTestId('crush-osd')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Fold all' }))
    expect(screen.queryAllByTestId('crush-osd')).toHaveLength(0)
  })

  it('shows an error when the map cannot be read', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'x' }, 500))
    renderTab(propsOf().props)

    expect(await screen.findByTestId('crush-error', undefined, { timeout: 8000 })).toHaveTextContent('Could not read the CRUSH map')
  }, 12000)
})
