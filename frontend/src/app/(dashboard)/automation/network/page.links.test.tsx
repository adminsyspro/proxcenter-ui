/**
 * Deep links of /automation/network (recette D1): `?tab=`, `?connection=`, `?sub=` and `?vm=` decide the tab, the
 * connection and the Micro-segmentation sub-tab the page opens on, over what the browser remembers; `?vm=` alone opens
 * Micro-segmentation > Overview on the connection holding that guest, targeted on it. The connection last shown is
 * remembered for the next opening. This file mocks next/navigation itself (the shared render helper stubs it with an
 * empty address), so it renders with its own providers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'

import enMessages from '@/messages/en.json'

const navigation = vi.hoisted(() => ({ search: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/automation/network',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'test' } }, status: 'authenticated' }),
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo: vi.fn() }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/contexts/LicenseContext', () => ({
  Features: { MICROSEGMENTATION: 'microsegmentation', SFLOW_MONITORING: 'sflow_monitoring' },
  useLicense: () => ({ isEnterprise: true, hasFeature: () => true }),
}))
vi.mock('@/components/guards/EnterpriseGuard', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/components/guards/ProviderTenantGuard', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/lib/api/firewall', () => ({}))
const TWO_CONNECTIONS = [{ id: 'a5000', name: 'PVE9-A5000', type: 'pve' }, { id: 'dr', name: 'PVE-DR', type: 'pve' }]
const pve = vi.hoisted(() => ({ connections: null as null | { id: string; name: string; type: string }[] }))
vi.mock('@/hooks/useConnections', () => ({
  usePVEConnections: () => ({ data: { data: pve.connections ?? TWO_CONNECTIONS } }),
}))
// What each data hook was asked for: the connection the page computes.
const asked = vi.hoisted(() => ({ firewall: [] as (string | null)[] }))
vi.mock('@/hooks/useFirewallData', () => ({
  useFirewallData: (connection: string | null) => {
    asked.firewall.push(connection)
    return {
      aliases: [], ipsets: [], securityGroups: [], clusterOptions: { enable: 1 }, clusterRules: [], nodeOptions: null, nodeRules: [],
      firewallMode: 'cluster', connectionInfo: null, nodesList: [], loading: false, loadError: null, reload: vi.fn(), setClusterRules: vi.fn(), setClusterOptions: vi.fn(),
    }
  },
}))
vi.mock('@/hooks/useVMFirewallRules', () => ({
  useVMFirewallRules: () => ({
    vmFirewallData: [], loadingVMRules: false, vmRulesError: null, guestsNotScanned: 0,
    loadVMFirewallData: vi.fn(), reloadVMFirewallRules: vi.fn(), setVMFirewallData: vi.fn(),
  }),
}))
vi.mock('@/hooks/useHostFirewallRules', () => ({
  useHostFirewallRules: () => ({ hostRulesByNode: {}, loadingHostRules: false, hostRulesError: null, loadHostRules: vi.fn(), reloadHostRulesForNode: vi.fn(), setHostRulesByNode: vi.fn() }),
}))
vi.mock('./components/DashboardTab', () => ({ default: ({ selectedConnection }: { selectedConnection: string }) => <div data-connection={selectedConnection}>dashboard tab</div> }))
vi.mock('./components/RulesTab', () => ({ default: ({ selectedConnection }: { selectedConnection: string }) => <div data-connection={selectedConnection}>rules tab</div> }))
vi.mock('./components/ObjectsTab', () => ({ default: ({ view }: { view: string }) => <div>objects tab {view}</div> }))
vi.mock('./components/rules/SecurityGroupsPanel', () => ({ default: () => <div>groups tab</div> }))
vi.mock('./components/LoggingTab', () => ({ default: () => <div>logging tab</div> }))
vi.mock('./components/microseg/MicrosegTab', () => ({
  default: ({ connectionId, initialSubTab, targetVm, onDissociated }: { connectionId: string; initialSubTab?: string; targetVm?: string | null; onDissociated?: (left: string, remaining: string[]) => void }) => (
    <div data-testid='microseg' data-connection={connectionId} data-subtab={initialSubTab ?? ''} data-vm={targetVm ?? ''}>
      microseg tab
      <button type='button' onClick={() => onDissociated?.(connectionId, ['dr', 'a5000'].filter(id => id !== connectionId))}>leave</button>
      <button type='button' onClick={() => onDissociated?.('gone', [connectionId])}>another leaves</button>
    </div>
  ),
}))

import NetworkAutomationPage from './page'

const INVENTORY = {
  data: {
    clusters: [
      { id: 'a5000', nodes: [{ node: 'n1', guests: [{ vmid: 100 }] }] },
      { id: 'dr', nodes: [{ node: 'pve1-dr', guests: [{ vmid: '98010' }] }] },
    ],
  },
}
// The clusters sharing a policy, as GET clusters answers them for each connection (none set: the read fails).
const clusterGroups: { ids: string[] | null } = { ids: null }
const fetchMock = vi.fn(async (url: string) => {
  if (url === '/api/v1/inventory') return new Response(JSON.stringify(INVENTORY), { status: 200 })
  if (clusterGroups.ids && /^\/api\/v1\/firewall\/microseg\/[^/]+\/clusters$/.test(url)) {
    const clusters = clusterGroups.ids.map(id => ({ connection_id: id, active: true, stop_cluster_disabled: false, policy_id: 'p', created_at: '', activated_at: null }))
    return new Response(JSON.stringify({ clusters, max: 8 }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
})

function open(search = '') {
  navigation.search = search
  return render(<NetworkAutomationPage />, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale='en' messages={enMessages as Record<string, unknown>}>
        <ThemeProvider theme={createTheme()}>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
        </ThemeProvider>
      </NextIntlClientProvider>
    ),
  })
}

const selectedName = () => screen.getByRole('combobox').textContent

beforeEach(() => {
  fetchMock.mockClear()
  asked.firewall = []
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  clusterGroups.ids = null
  pve.connections = null
  navigation.search = ''
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('?tab=', () => {
  it.each([
    ['dashboard', 'dashboard tab'], ['firewalling', 'rules tab'], ['aliases', 'objects tab aliases'], ['ipsets', 'objects tab ipsets'],
    ['groups', 'groups tab'], ['logging', 'logging tab'], ['microseg', 'microseg tab'],
  ])('opens on the %s tab', async (tab, content) => {
    open(`tab=${tab}`)
    expect(await screen.findByText(content)).toBeInTheDocument()
  })

  it('opens on the Dashboard for an unknown tab', async () => {
    open('tab=nope')
    expect(await screen.findByText('dashboard tab')).toBeInTheDocument()
  })
})

describe('the former Network flows tab', () => {
  it('is gone: a link to it opens the Dashboard, the tabs run without it', async () => {
    open('tab=flows&connection=dr')
    expect(await screen.findByText('dashboard tab')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual([
      'Dashboard', 'Micro-segmentation', 'Firewalling', 'Logging', 'Security Groups', 'IP Sets', 'Aliases',
    ])
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('?sub=', () => {
  it('opens Micro-segmentation on the sub-tab of the link, over the one remembered', async () => {
    window.localStorage.setItem('microseg.subTab', 'policy')
    open('tab=microseg&sub=drifts')
    expect((await screen.findByTestId('microseg')).dataset.subtab).toBe('drifts')
  })

  it('ignores an unknown sub-tab, and a sub-tab without the Micro-segmentation tab', async () => {
    open('tab=microseg&sub=nope')
    expect((await screen.findByTestId('microseg')).dataset.subtab).toBe('')
    cleanup()
    open('sub=drifts')
    expect(await screen.findByText('dashboard tab')).toBeInTheDocument()
  })
})

describe('?connection=', () => {
  it('selects the connection of the link over the one remembered', async () => {
    window.localStorage.setItem('network.connection', 'a5000')
    open('connection=dr')
    expect((await screen.findByText('dashboard tab')).dataset.connection).toBe('dr')
    expect(selectedName()).toBe('PVE-DR')
  })

  it('falls back on the remembered connection, then the first, for a connection that does not exist', async () => {
    window.localStorage.setItem('network.connection', 'dr')
    open('connection=gone')
    expect((await screen.findByText('dashboard tab')).dataset.connection).toBe('dr')
    cleanup()
    window.localStorage.clear()
    open('connection=gone')
    expect((await screen.findByText('dashboard tab')).dataset.connection).toBe('a5000')
  })
})

describe('?vm=', () => {
  it('lands a cold page on Micro-segmentation > Overview, on the connection holding the guest, targeted on it', async () => {
    window.localStorage.setItem('microseg.subTab', 'policy')
    window.localStorage.setItem('network.connection', 'a5000')
    open('vm=98010')
    // While the guest is looked up no connection is selected, and the page does not say there is none.
    expect(screen.queryByText(/No PVE connection configured/)).toBeNull()

    await waitFor(() => expect(screen.getByTestId('microseg').dataset.connection).toBe('dr'))
    expect(screen.getByTestId('microseg').dataset.subtab).toBe('overview')
    expect(screen.getByTestId('microseg').dataset.vm).toBe('98010')
    expect(screen.getByRole('tab', { name: 'Micro-segmentation' })).toHaveAttribute('aria-selected', 'true')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/inventory', expect.anything())
    // Nothing was computed for another connection while the guest was looked up.
    expect(asked.firewall.filter(Boolean)).not.toContain('a5000')
  })

  it('uses ?connection= as given, without reading the inventory', async () => {
    open('vm=98010&connection=a5000')
    expect((await screen.findByTestId('microseg')).dataset.connection).toBe('a5000')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/inventory', expect.anything())
  })

  it('falls back on the usual connection when the inventory refuses or holds no such guest', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 403 }))
    window.localStorage.setItem('network.connection', 'dr')
    open('vm=555')
    await waitFor(() => expect(screen.getByTestId('microseg').dataset.connection).toBe('dr'))
    cleanup()
    window.localStorage.clear()
    open('vm=555')
    await waitFor(() => expect(screen.getByTestId('microseg').dataset.connection).toBe('a5000'))
  })
})

describe('the remembered connection', () => {
  it('opens on the connection last shown, not the first, and remembers a new pick', async () => {
    window.localStorage.setItem('network.connection', 'dr')
    open()
    expect((await screen.findByText('dashboard tab')).dataset.connection).toBe('dr')
    expect(asked.firewall.filter(Boolean)).not.toContain('a5000')

    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'PVE9-A5000' }))
    await waitFor(() => expect(window.localStorage.getItem('network.connection')).toBe('a5000'))
  })

  it('starts on the first connection and remembers it when nothing is stored, or storage is blocked', async () => {
    open()
    expect((await screen.findByText('dashboard tab')).dataset.connection).toBe('a5000')
    expect(window.localStorage.getItem('network.connection')).toBe('a5000')
    cleanup()

    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    open()
    expect((await screen.findByText('dashboard tab')).dataset.connection).toBe('a5000')
    getItem.mockRestore()
    setItem.mockRestore()
  })
})

describe('the selector of Micro-segmentation and of the Dashboard', () => {
  const clustersReads = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/clusters'))

  it('shows the clusters sharing one policy as one entry, valued with the group anchor', async () => {
    clusterGroups.ids = ['dr', 'a5000']
    open('tab=microseg&connection=dr')
    await waitFor(() => expect(selectedName()).toBe('PVE-DR + PVE9-A5000'))
    // A long group label is cut with an ellipsis: the whole label stays readable on hover.
    expect(screen.getByTitle('PVE-DR + PVE9-A5000')).toBeInTheDocument()
    // The tab stays on the connection of the link; the entry stands for the whole group.
    expect(screen.getByTestId('microseg').dataset.connection).toBe('dr')
    fireEvent.mouseDown(screen.getByRole('combobox'))
    expect((await screen.findAllByRole('option')).map(o => o.textContent)).toEqual(['PVE-DR + PVE9-A5000'])
  })

  it('keeps the plain list on the other tabs, without reading any group', async () => {
    clusterGroups.ids = ['dr', 'a5000']
    open('tab=firewalling&connection=dr')
    expect(await screen.findByText('rules tab')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox'))
    expect((await screen.findAllByRole('option')).map(o => o.textContent)).toEqual(['PVE9-A5000', 'PVE-DR'])
    expect(clustersReads()).toHaveLength(0)
  })

  it('offers the entry of a shared policy on the Dashboard too, and keeps it selected from one of the two tabs to the other', async () => {
    clusterGroups.ids = ['dr', 'a5000']
    open('tab=dashboard&connection=dr')
    await waitFor(() => expect(selectedName()).toBe('PVE-DR + PVE9-A5000'))
    fireEvent.mouseDown(screen.getByRole('combobox'))
    expect((await screen.findAllByRole('option')).map(o => o.textContent)).toEqual(['PVE-DR + PVE9-A5000'])
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    // The entry stands for the group: the Dashboard stays on the connection of the link and shows the whole policy.
    expect(screen.getByText('dashboard tab').dataset.connection).toBe('dr')

    fireEvent.click(screen.getByRole('tab', { name: 'Micro-segmentation' }))
    expect((await screen.findByTestId('microseg')).dataset.connection).toBe('dr')
    expect(selectedName()).toBe('PVE-DR + PVE9-A5000')
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }))
    expect(await screen.findByText('dashboard tab')).toBeInTheDocument()
    expect(selectedName()).toBe('PVE-DR + PVE9-A5000')
    // Each connection's group was read once for both tabs.
    expect(clustersReads()).toHaveLength(2)

    // Firewalling stays per connection.
    fireEvent.click(screen.getByRole('tab', { name: 'Firewalling' }))
    expect(await screen.findByText('rules tab')).toBeInTheDocument()
    expect(selectedName()).toBe('PVE-DR')
  })

  it('moves to the cluster that remains when the connection the page is on is dissociated', async () => {
    clusterGroups.ids = ['dr', 'a5000']
    open('tab=microseg&connection=dr')
    await waitFor(() => expect(selectedName()).toBe('PVE-DR + PVE9-A5000'))
    clusterGroups.ids = ['a5000']
    fireEvent.click(screen.getByRole('button', { name: 'leave' }))
    await waitFor(() => expect(screen.getByTestId('microseg').dataset.connection).toBe('a5000'))
    expect(window.localStorage.getItem('network.connection')).toBe('a5000')
  })

  it('stays on the group when another cluster leaves', async () => {
    clusterGroups.ids = ['dr', 'a5000']
    open('tab=microseg&connection=a5000')
    await waitFor(() => expect(selectedName()).toBe('PVE-DR + PVE9-A5000'))
    fireEvent.click(screen.getByRole('button', { name: 'another leaves' }))
    expect(screen.getByTestId('microseg').dataset.connection).toBe('a5000')
    expect(selectedName()).toBe('PVE-DR + PVE9-A5000')
  })

  it('keeps one entry per connection when the groups cannot be read', async () => {
    open('tab=microseg&connection=dr')
    await waitFor(() => expect(clustersReads().length).toBeGreaterThanOrEqual(2))
    expect(selectedName()).toBe('PVE-DR')
    fireEvent.mouseDown(screen.getByRole('combobox'))
    expect((await screen.findAllByRole('option')).map(o => o.textContent)).toEqual(['PVE9-A5000', 'PVE-DR'])
  })
})

describe('the selector of Micro-segmentation with one connection', () => {
  it('reads no group of its own', async () => {
    pve.connections = [{ id: 'a5000', name: 'PVE9-A5000', type: 'pve' }]
    clusterGroups.ids = ['a5000']
    open('tab=microseg')
    expect(await screen.findByTestId('microseg')).toBeInTheDocument()
    expect(selectedName()).toBe('PVE9-A5000')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/clusters'))).toHaveLength(0)
  })
})
