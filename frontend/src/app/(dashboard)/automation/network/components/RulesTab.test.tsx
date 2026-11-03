/**
 * Component tests for RulesTab.tsx, the frame of the Firewalling tab (UA51): the load error on top, the Dashboard's
 * guest filter, and what it hands the table (the scope it opens on, the guests listed). The table itself is covered
 * by FirewallingView.test.tsx; it is stubbed here so the frame is what is under test.
 *
 * No automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

const h = vi.hoisted(() => ({ view: vi.fn() }))

vi.mock('./rules/FirewallingView', () => ({
  default: (p: any) => {
    h.view(p)
    return <div data-testid='view' data-scope={p.initialScope} data-guests={p.guests.map((g: VMFirewallInfo) => g.name).join(',')} />
  },
}))

import RulesTab from './RulesTab'

const WEB_VM: VMFirewallInfo = {
  vmid: 100, name: 'web-01', node: 'pve1', type: 'qemu', status: 'running',
  firewallEnabled: true, optionsEnabled: true, nicFirewallEnabled: true, options: null, vlans: [20],
  rules: [], rulesLoaded: false, stateUnknown: false, tags: [],
}

function props(overrides: Partial<React.ComponentProps<typeof RulesTab>> = {}): React.ComponentProps<typeof RulesTab> {
  return {
    activeSubTab: 0,
    onSubTabChange: vi.fn(),
    clusterRules: [] as firewallAPIType.FirewallRule[],
    setClusterRules: vi.fn(),
    clusterOptions: { enable: 1 } as firewallAPIType.ClusterOptions,
    setClusterOptions: vi.fn(),
    hostRulesByNode: {},
    setHostRulesByNode: vi.fn(),
    nodesList: ['pve1'],
    vmFirewallData: [WEB_VM],
    setVMFirewallData: vi.fn(),
    loadingVMRules: false,
    loadVMFirewallData: vi.fn().mockResolvedValue(undefined),
    loadGuestRules: vi.fn().mockResolvedValue([]),
    securityGroups: [],
    aliases: [],
    ipsets: [],
    firewallMode: 'cluster' as firewallAPIType.FirewallMode,
    selectedConnection: 'conn-1',
    reload: vi.fn(),
    ...overrides,
  }
}

const view = () => screen.getByTestId('view')

describe('RulesTab', () => {
  afterEach(cleanup)
  beforeEach(() => vi.clearAllMocks())

  it('opens the table on everything, the hosts or the VMs as the Dashboard link asks', () => {
    renderWithProviders(<RulesTab {...props()} />)
    expect(view()).toHaveAttribute('data-scope', 'all')
    cleanup()
    renderWithProviders(<RulesTab {...props({ activeSubTab: 1 })} />)
    expect(view()).toHaveAttribute('data-scope', 'hosts')
    cleanup()
    renderWithProviders(<RulesTab {...props({ activeSubTab: 2 })} />)
    expect(view()).toHaveAttribute('data-scope', 'vms')
  })

  it('opens a single node on everything: it has no cluster section to start from', () => {
    renderWithProviders(<RulesTab {...props({ activeSubTab: 1, firewallMode: 'standalone' })} />)
    expect(view()).toHaveAttribute('data-scope', 'all')
  })

  it('shows no table without a connection', () => {
    renderWithProviders(<RulesTab {...props({ selectedConnection: '' })} />)
    expect(screen.queryByTestId('view')).toBeNull()
  })

  it('reads the guest list again, forced, on the table Refresh', async () => {
    const p = props()
    renderWithProviders(<RulesTab {...p} />)
    await h.view.mock.calls[0][0].reloadGuests()
    expect(p.loadVMFirewallData).toHaveBeenCalledWith(true)
  })
})

describe('RulesTab load error', () => {
  afterEach(cleanup)

  it('warns on top when the firewall data could not be loaded, and retries with reload', () => {
    const p = props({ loadError: 'HTTP 502' })
    renderWithProviders(<RulesTab {...p} />)
    expect(screen.getByText(/Some firewall data could not be loaded.*HTTP 502/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(p.reload).toHaveBeenCalledTimes(1)
  })

  it('shows nothing when it loaded', () => {
    renderWithProviders(<RulesTab {...props({ loadError: null })} />)
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
  })
})

describe('RulesTab guest filter from the Dashboard (UA46)', () => {
  afterEach(cleanup)

  const OFF_VM: VMFirewallInfo = { ...WEB_VM, vmid: 101, name: 'db-01', firewallEnabled: false, optionsEnabled: false }
  const UNKNOWN_VM: VMFirewallInfo = { ...WEB_VM, vmid: 102, name: 'app-01', firewallEnabled: false, stateUnknown: true }

  it('lists only the guests certainly without firewall, on the VMs, says so, and drops the filter on request', () => {
    const onClearGuestFilter = vi.fn()
    renderWithProviders(<RulesTab {...props({ vmFirewallData: [WEB_VM, OFF_VM, UNKNOWN_VM], guestFilter: 'unprotected', onClearGuestFilter })} />)
    expect(screen.getByTestId('guest-filter')).toHaveTextContent('1 guest without firewall')
    expect(view()).toHaveAttribute('data-guests', 'db-01')
    expect(view()).toHaveAttribute('data-scope', 'vms')
    expect(h.view.mock.calls.at(-1)![0].listFilter).toBe('unprotected')
    fireEvent.click(screen.getByRole('button', { name: 'Show every guest' }))
    expect(onClearGuestFilter).toHaveBeenCalledTimes(1)
  })

  it('lists every guest without the filter', () => {
    renderWithProviders(<RulesTab {...props({ vmFirewallData: [WEB_VM, OFF_VM] })} />)
    expect(screen.queryByTestId('guest-filter')).not.toBeInTheDocument()
    expect(view()).toHaveAttribute('data-guests', 'web-01,db-01')
  })
})
