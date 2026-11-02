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
vi.mock('./components/DashboardTab', () => ({ default: () => <div>dashboard tab</div> }))
vi.mock('./components/RulesTab', () => ({ default: () => <div>rules tab</div> }))
vi.mock('./components/ObjectsTab', () => ({ default: () => <div>objects tab</div> }))
vi.mock('./components/rules/SecurityGroupsPanel', () => ({ default: () => <div>groups tab</div> }))
vi.mock('./components/LoggingTab', () => ({ default: () => <div>logging tab</div> }))
vi.mock('./components/microseg/MicrosegTab', () => ({ default: () => <div>microseg tab</div> }))

import NetworkAutomationPage from './page'

afterEach(cleanup)

const STAT_SUBVALUES = [/named networks/i, /entries$/i, /Firewall (active|inactive)/i]

const expectNoSummary = () => {
  for (const subvalue of STAT_SUBVALUES) expect(screen.queryByText(subvalue)).not.toBeInTheDocument()
  expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/cluster rules unreadable/)).not.toBeInTheDocument()
}

describe('network page header', () => {
  it('shows no StatCard and no firewall load error above the tabs, on any tab', async () => {
    renderWithProviders(<NetworkAutomationPage />)
    expect(await screen.findByText('dashboard tab')).toBeInTheDocument()
    expectNoSummary()

    for (const [tab, content] of [['Logging', 'logging tab'], ['Micro-segmentation', 'microseg tab'], ['Aliases', 'objects tab']] as const) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      expect(await screen.findByText(content)).toBeInTheDocument()
      expectNoSummary()
    }
  })

  it('logs the load error to the console so a broken backend stays diagnosable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithProviders(<NetworkAutomationPage />)
    await screen.findByText('dashboard tab')
    expect(log).toHaveBeenCalledWith('Network security: firewall data could not be loaded:', 'cluster rules unreadable')
    log.mockRestore()
  })
})
