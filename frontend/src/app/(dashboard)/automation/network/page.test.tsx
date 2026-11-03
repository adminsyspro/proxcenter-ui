/**
 * The page shows no firewall summary strip (the four StatCards) and no firewall load-error alert above its tabs:
 * the Dashboard tab and the other tabs carry their own state. The load error goes to the console.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo: vi.fn() }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/contexts/LicenseContext', () => ({
  Features: { MICROSEGMENTATION: 'microsegmentation' },
  useLicense: () => ({ isEnterprise: true }),
}))
vi.mock('@/components/guards/EnterpriseGuard', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/components/guards/ProviderTenantGuard', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/lib/api/firewall', () => ({}))
vi.mock('@/hooks/useConnections', () => ({
  usePVEConnections: () => ({ data: { data: [{ id: 'c1', name: 'lab', type: 'pve', baseUrl: '' }] } }),
}))
vi.mock('@/hooks/useFirewallData', () => ({
  useFirewallData: () => ({
    aliases: [], ipsets: [], securityGroups: [], clusterOptions: { enable: 1 }, clusterRules: [],
    nodeOptions: null, nodeRules: [], firewallMode: 'cluster', connectionInfo: null, nodesList: ['pve1'],
    loading: false, loadError: 'cluster rules unreadable', reload: vi.fn(), setClusterRules: vi.fn(), setClusterOptions: vi.fn(),
  }),
}))
const { loadVMFirewallData } = vi.hoisted(() => ({ loadVMFirewallData: vi.fn() }))
vi.mock('@/hooks/useVMFirewallRules', () => ({
  useVMFirewallRules: () => ({
    vmFirewallData: [], loadingVMRules: false, vmRulesError: null, guestsNotScanned: 0,
    loadVMFirewallData, reloadVMFirewallRules: vi.fn(), setVMFirewallData: vi.fn(),
  }),
}))
vi.mock('@/hooks/useHostFirewallRules', () => ({
  useHostFirewallRules: () => ({
    hostRulesByNode: {}, loadingHostRules: false, hostRulesError: null, loadHostRules: vi.fn(),
    reloadHostRulesForNode: vi.fn(), setHostRulesByNode: vi.fn(),
  }),
}))
vi.mock('./components/DashboardTab', () => ({
  default: ({ loadError, connectionName, onOpenGuests, onOpenMicroseg }: { loadError?: string | null; connectionName?: string; onOpenGuests?: (f?: string) => void; onOpenMicroseg?: (s?: string) => void }) => (
    <div data-connection={connectionName}>
      dashboard tab{loadError ? ` (error: ${loadError})` : ''}
      <button onClick={() => onOpenGuests?.('unprotected')}>todo guests</button>
      <button onClick={() => onOpenMicroseg?.('drifts')}>todo drifts</button>
    </div>
  ),
}))
vi.mock('./components/RulesTab', async () => {
  const { useMicrosegWrite } = await import('./components/microseg/microsegAccess')
  return {
    default: function RulesTabMock({ loadError, activeSubTab, guestFilter, onClearGuestFilter }: { loadError?: string | null; activeSubTab: number; guestFilter?: string | null; onClearGuestFilter?: () => void }) {
      const { canWrite } = useMicrosegWrite()
      return (
        <div data-subtab={activeSubTab} data-filter={guestFilter ?? ''} data-can-write={String(canWrite)}>
          rules tab{loadError ? ` (error: ${loadError})` : ''}
          <button onClick={onClearGuestFilter}>clear filter</button>
        </div>
      )
    },
  }
})
vi.mock('./components/ObjectsTab', () => ({ default: ({ loadError }: { loadError?: string | null }) => <div>objects tab{loadError ? ` (error: ${loadError})` : ''}</div> }))
vi.mock('./components/rules/SecurityGroupsPanel', () => ({ default: ({ loadError }: { loadError?: string | null }) => <div>groups tab{loadError ? ` (error: ${loadError})` : ''}</div> }))
vi.mock('./components/LoggingTab', () => ({ default: () => <div>logging tab</div> }))
vi.mock('./components/microseg/MicrosegTab', () => ({ default: ({ initialSubTab }: { initialSubTab?: string }) => <div data-subtab={initialSubTab ?? ''}>microseg tab</div> }))

import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'

import NetworkAutomationPage from './page'

afterEach(() => {
  cleanup()
  loadVMFirewallData.mockClear()
})

const STAT_SUBVALUES = [/named networks/i, /entries$/i, /Firewall (active|inactive)/i]

const expectNoSummary = () => {
  for (const subvalue of STAT_SUBVALUES) expect(screen.queryByText(subvalue)).not.toBeInTheDocument()
  expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
}

describe('network page header', () => {
  it('puts the connection selector on the row of the tabs, at its right end', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    await screen.findByText(/dashboard tab/)

    const tablist = screen.getByRole('tablist')
    const selector = screen.getByRole('combobox')
    const row = tablist.closest('.MuiTabs-root')!.parentElement!
    expect(row.contains(selector)).toBe(true)
    expect(row.contains(screen.getByRole('button', { name: '' }))).toBe(true)
    const children = [...row.children]
    expect(children[0]).toBe(tablist.closest('.MuiTabs-root'))
    expect(children[children.length - 1].contains(selector)).toBe(true)
  })

  it('still selects the connection and refreshes from the selector', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    await screen.findByText(/dashboard tab/)

    expect(screen.getByRole('combobox')).toHaveTextContent('lab')
    expect(screen.getByRole('button', { name: '' })).toBeEnabled()
  })

  it('shows no StatCard and no firewall load error above the tabs, on any tab', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    expect(await screen.findByText(/dashboard tab/)).toBeInTheDocument()
    expectNoSummary()

    for (const [tab, content] of [['Logging', 'logging tab'], ['Micro-segmentation', 'microseg tab'], ['Aliases', 'objects tab']] as const) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      expect(await screen.findByText(new RegExp(content))).toBeInTheDocument()
      expectNoSummary()
    }
  })

  it('logs the load error to the console so a broken backend stays diagnosable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithProviders(<NetworkAutomationPage />)
    await screen.findByText(/dashboard tab/)
    expect(log).toHaveBeenCalledWith('Network security: firewall data could not be loaded:', 'cluster rules unreadable')
    log.mockRestore()
  })
})

describe('network page load error', () => {
  it('hands the load error to the tabs that list firewall data', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    expect(await screen.findByText('dashboard tab (error: cluster rules unreadable)')).toBeInTheDocument()

    for (const [tab, content] of [['Firewalling', 'rules tab'], ['Aliases', 'objects tab'], ['IP Sets', 'objects tab'], ['Security Groups', 'groups tab']] as const) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      expect(await screen.findByText(`${content} (error: cluster rules unreadable)`)).toBeInTheDocument()
    }
  })
})

describe('network page Dashboard load (UA44)', () => {
  it('does not start the three-calls-per-guest scan for the Dashboard, and hands it the connection name', async () => {
    renderWithProviders(<NetworkAutomationPage />)

    expect((await screen.findByText(/dashboard tab/)).dataset.connection).toBe('lab')
    expect(loadVMFirewallData).not.toHaveBeenCalled()
  })

  it('reads no guest list for the Firewalling cluster rules, which show none', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    await screen.findByText(/dashboard tab/)

    fireEvent.click(screen.getByRole('tab', { name: /Firewalling/ }))

    expect(await screen.findByText(/rules tab/)).toBeInTheDocument()
    expect(loadVMFirewallData).not.toHaveBeenCalled()
  })

  it('reads the guest list for the Security Groups tab (one request, the rules stay on demand)', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    await screen.findByText(/dashboard tab/)

    fireEvent.click(screen.getByRole('tab', { name: /Security Groups/ }))

    expect(loadVMFirewallData).toHaveBeenCalled()
  })
})

describe('network page: the Dashboard "To do" links (UA46)', () => {
  it('opens Firewalling > VMs filtered on the guests without firewall, and drops the filter on request', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'todo guests' }))

    const rules = await screen.findByText(/rules tab/)
    expect(rules.dataset.subtab).toBe('2')
    expect(rules.dataset.filter).toBe('unprotected')

    fireEvent.click(screen.getByRole('button', { name: 'clear filter' }))
    expect(screen.getByText(/rules tab/).dataset.filter).toBe('')
  })

  it('drops the filter when the user changes tab', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'todo guests' }))
    await screen.findByText(/rules tab/)

    fireEvent.click(screen.getByRole('tab', { name: /Dashboard/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Firewalling/ }))

    expect((await screen.findByText(/rules tab/)).dataset.filter).toBe('')
  })

  it('opens the Micro-segmentation tab on the sub-tab the line asks for', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'todo drifts' }))

    expect((await screen.findByText('microseg tab')).dataset.subtab).toBe('drifts')
  })
})

describe('network page: write access of the firewall tabs', () => {
  const rbac = (grant: boolean): RBACContextValue => ({
    permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading: false,
    hasPermission: () => grant, hasAnyPermission: () => grant, hasAllPermissions: () => grant,
    hasPermissionOn: (permission: string, type: string, id: string) => grant && permission === 'node.manage' && type === 'connection' && id === 'c1',
    refresh: () => undefined,
  })

  it.each([[false, 'false'], [true, 'true']])('hands node.manage on the connection (%s) down to the Firewalling tab', async (grant, shown) => {
    renderWithProviders(<RBACContext.Provider value={rbac(grant)}><NetworkAutomationPage /></RBACContext.Provider>)
    fireEvent.click(await screen.findByRole('tab', { name: /Firewalling/ }))

    expect((await screen.findByText(/rules tab/)).dataset.canWrite).toBe(shown)
  })
})
