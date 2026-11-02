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
vi.mock('@/hooks/useVMFirewallRules', () => ({
  useVMFirewallRules: () => ({
    vmFirewallData: [], loadingVMRules: false, vmRulesError: null, guestsNotScanned: 0,
    loadVMFirewallData: vi.fn(), reloadVMFirewallRules: vi.fn(), setVMFirewallData: vi.fn(),
  }),
}))
vi.mock('@/hooks/useHostFirewallRules', () => ({
  useHostFirewallRules: () => ({
    hostRulesByNode: {}, loadingHostRules: false, hostRulesError: null, loadHostRules: vi.fn(),
    reloadHostRulesForNode: vi.fn(), setHostRulesByNode: vi.fn(),
  }),
}))
vi.mock('./components/DashboardTab', () => ({ default: ({ loadError }: { loadError?: string | null }) => <div>dashboard tab{loadError ? ` (error: ${loadError})` : ''}</div> }))
vi.mock('./components/RulesTab', () => ({ default: ({ loadError }: { loadError?: string | null }) => <div>rules tab{loadError ? ` (error: ${loadError})` : ''}</div> }))
vi.mock('./components/ObjectsTab', () => ({ default: ({ loadError }: { loadError?: string | null }) => <div>objects tab{loadError ? ` (error: ${loadError})` : ''}</div> }))
vi.mock('./components/rules/SecurityGroupsPanel', () => ({ default: ({ loadError }: { loadError?: string | null }) => <div>groups tab{loadError ? ` (error: ${loadError})` : ''}</div> }))
vi.mock('./components/LoggingTab', () => ({ default: () => <div>logging tab</div> }))
vi.mock('./components/microseg/MicrosegTab', () => ({ default: () => <div>microseg tab</div> }))

import NetworkAutomationPage from './page'

afterEach(cleanup)

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
