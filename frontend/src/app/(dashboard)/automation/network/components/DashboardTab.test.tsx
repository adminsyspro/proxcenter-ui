/**
 * The dashboard's policy chips, score and "Policy IN permissive" advice read
 * the cluster policy, which PVE leaves unset until someone changes it and then
 * enforces as DROP inbound (#1065). No automatic RTL cleanup in this repo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'

import DashboardTab from './DashboardTab'

afterEach(cleanup)

function renderDashboard(clusterOptions: firewallAPIType.ClusterOptions) {
  renderWithProviders(
    <DashboardTab
      securityGroups={[]}
      clusterOptions={clusterOptions}
      clusterRules={[]}
      aliases={[]}
      ipsets={[]}
      vmFirewallData={[]}
      loadingVMRules={false}
      firewallMode="cluster"
      currentOptions={clusterOptions}
      selectedConnection="conn-1"
      totalRules={0}
      totalIPSetEntries={0}
      nodesList={['pve1']}
      reload={vi.fn()}
      onNavigateTab={vi.fn()}
      onNavigateRulesSubTab={vi.fn()}
    />,
  )
}

describe('DashboardTab cluster policy', () => {
  it('shows an unset policy as DROP in / ACCEPT out, with no permissive-policy advice', () => {
    renderDashboard({ enable: 1 })

    expect(screen.getByText('IN: DROP')).toBeInTheDocument()
    expect(screen.getByText('OUT: ACCEPT')).toBeInTheDocument()
    expect(screen.queryByText('Policy IN permissive')).not.toBeInTheDocument()
  })

  it('still flags an explicit ACCEPT inbound policy', () => {
    renderDashboard({ enable: 1, policy_in: 'ACCEPT' })

    expect(screen.getByText('IN: ACCEPT')).toBeInTheDocument()
    expect(screen.getByText('Policy IN permissive')).toBeInTheDocument()
  })
})
