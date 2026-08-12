/**
 * Component tests for RulesTab.tsx — the sub-tab switcher above the three
 * rules tables (cluster, hosts, VMs/CTs).
 *
 * Two behaviours live here rather than in the panels below. The rule counts on
 * the three toggles are summed by this component, so a wrong sum misreports
 * the cluster at a glance. And the legacy sub-tab remap is real logic: the
 * stat cards and the dashboard tab still address the old five-tab layout, so
 * an index above 2 (old 3 = Security Groups) has to be folded back onto the
 * three that remain and reported upwards, or the tab would render nothing.
 *
 * The panels themselves are covered by their own suites; here they are kept
 * inert with empty collections so the switcher is what is under test. The
 * firewall API module is stubbed for the same reason — the cluster panel it
 * mounts on the default tab would otherwise reach the network.
 *
 * No automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

vi.mock('@/lib/api/firewall', () => ({
  updateClusterOptions: vi.fn(),
  getClusterRules: vi.fn(),
  addClusterRule: vi.fn(),
  deleteClusterRule: vi.fn(),
  getNodeOptions: vi.fn(),
  updateNodeOptions: vi.fn(),
  addNodeRule: vi.fn(),
  deleteNodeRule: vi.fn(),
  toggleVMNICFirewall: vi.fn(),
  updateVMOptions: vi.fn(),
  addVMRule: vi.fn(),
  updateVMRule: vi.fn(),
  deleteVMRule: vi.fn(),
  getVMFirewallLog: vi.fn(),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import RulesTab from './RulesTab'

const CLUSTER_RULES: firewallAPIType.FirewallRule[] = [
  { pos: 0, type: 'in', action: 'ACCEPT' },
  { pos: 1, type: 'in', action: 'DROP' },
]

const WEB_VM: VMFirewallInfo = {
  vmid: 100, name: 'web-01', node: 'pve1', type: 'qemu', status: 'running',
  firewallEnabled: true, options: null, vlans: [20],
  rules: [{ pos: 0, type: 'in', action: 'ACCEPT' }],
}

function props(overrides: Partial<React.ComponentProps<typeof RulesTab>> = {}) {
  return {
    activeSubTab: 0,
    onSubTabChange: vi.fn(),
    clusterRules: CLUSTER_RULES,
    setClusterRules: vi.fn(),
    clusterOptions: { enable: 1 } as firewallAPIType.ClusterOptions,
    setClusterOptions: vi.fn(),
    hostRulesByNode: { pve1: [{ pos: 0, type: 'in', action: 'ACCEPT' }], pve2: [] },
    nodesList: [] as string[],
    loadingHostRules: false,
    loadHostRules: vi.fn().mockResolvedValue(undefined),
    reloadHostRulesForNode: vi.fn().mockResolvedValue(undefined),
    vmFirewallData: [WEB_VM],
    loadingVMRules: false,
    loadVMFirewallData: vi.fn().mockResolvedValue(undefined),
    reloadVMFirewallRules: vi.fn().mockResolvedValue(undefined),
    securityGroups: [] as firewallAPIType.SecurityGroup[],
    aliases: [] as firewallAPIType.Alias[],
    ipsets: [] as firewallAPIType.IPSet[],
    firewallMode: 'cluster' as firewallAPIType.FirewallMode,
    totalRules: 3,
    selectedConnection: 'conn-1',
    reload: vi.fn(),
    ...overrides,
  }
}

function renderTab(overrides: Parameters<typeof props>[0] = {}) {
  const p = props(overrides)

  renderWithProviders(<RulesTab {...p} />)

  return p
}

const toggle = (name: RegExp) => screen.getByRole('button', { name })

describe('RulesTab', () => {
  afterEach(cleanup)

  beforeEach(() => vi.clearAllMocks())

  it('counts the rules of each scope on its toggle', () => {
    renderTab()

    // Two cluster rules, one host rule across the two nodes, one VM rule.
    expect(toggle(/Cluster/)).toHaveTextContent('2')
    expect(toggle(/Host Rules/)).toHaveTextContent('1')
    expect(toggle(/VM/)).toHaveTextContent('1')
  })

  it('shows the cluster table on the first sub-tab', () => {
    renderTab()

    expect(screen.getByText('Cluster Firewall')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search host...')).not.toBeInTheDocument()
  })

  it('shows the host panel on the second sub-tab', () => {
    renderTab({ activeSubTab: 1 })

    expect(screen.getByPlaceholderText('Search host...')).toBeInTheDocument()
    expect(screen.queryByText('Cluster Firewall')).not.toBeInTheDocument()
  })

  it('shows the VM panel on the third sub-tab', () => {
    renderTab({ activeSubTab: 2 })

    expect(screen.getByPlaceholderText('Search VM...')).toBeInTheDocument()
  })

  it('reports a sub-tab change to the page', () => {
    const p = renderTab()

    fireEvent.click(toggle(/Host Rules/))

    expect(p.onSubTabChange).toHaveBeenCalledWith(1)
  })

  it('folds a legacy sub-tab index back onto the three that remain', () => {
    // Old index 3 was Security Groups, which no longer has its own sub-tab.
    const p = renderTab({ activeSubTab: 3 })

    expect(p.onSubTabChange).toHaveBeenCalledWith(0)

    // It renders the cluster table meanwhile rather than nothing at all.
    expect(screen.getByText('Cluster Firewall')).toBeInTheDocument()
  })

  it('swaps in the dark Proxmox logo on the Host Rules toggle when the theme is dark', () => {
    renderTab()
    expect(document.querySelector('img')).toHaveAttribute('src', '/images/proxmox-logo.svg')

    cleanup()

    const dark = createTheme({ palette: { mode: 'dark' } })

    renderWithProviders(<ThemeProvider theme={dark}><RulesTab {...props()} /></ThemeProvider>)
    expect(document.querySelector('img')).toHaveAttribute('src', '/images/proxmox-logo-dark.svg')
  })
})
