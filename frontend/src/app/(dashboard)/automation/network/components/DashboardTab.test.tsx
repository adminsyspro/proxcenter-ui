/**
 * The dashboard's policy chips, score and "Policy IN permissive" advice read
 * the cluster policy, which PVE leaves unset until someone changes it and then
 * enforces as DROP inbound (#1065). No automatic RTL cleanup in this repo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'

import DashboardTab from './DashboardTab'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubMicrosegRelay() {
  const answer = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/status')) {
      return answer({
        engine: { paused_until: null, held: false, last_runs: {}, last_log: null },
        coverage: { running: 5, zoned: 3, members: 3, protected: 2 },
        zones_by_state: { disabled: 0, observe: 0, enforce: 0 },
        emergency_stop: false,
      })
    }
    if (url.endsWith('/policy')) {
      return answer({
        policy: { id: 'p1', connection_id: 'conn-1', tag_prefix: 'zone-', version: 1, settings: {}, emergency_stop: false },
        zones: [], flows: [], pending_members: [], last_revision: null, version: 1, pending_changes: false,
      })
    }
    return { ok: false, status: 404, text: async () => JSON.stringify({ code: 'NOT_FOUND', error: 'no' }) }
  }))
}

function renderDashboard(clusterOptions: firewallAPIType.ClusterOptions, over: { selectedConnection?: string; onNavigateTab?: (tab: number) => void } = {}) {
  // The shared test provider does not read on mount; the page does.
  renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, refreshInterval: 0 }}>
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
      selectedConnection={over.selectedConnection ?? 'conn-1'}
      totalRules={0}
      totalIPSetEntries={0}
      nodesList={['pve1']}
      reload={vi.fn()}
      onNavigateTab={over.onNavigateTab ?? vi.fn()}
      onNavigateRulesSubTab={vi.fn()}
    />
    </SWRConfig>,
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

describe('DashboardTab micro-segmentation card', () => {
  it('shows the micro-segmentation at a glance and opens its tab (6) from the card', async () => {
    stubMicrosegRelay()
    const onNavigateTab = vi.fn()
    renderDashboard({ enable: 1 }, { onNavigateTab })

    expect(await screen.findByText('Not deployed')).toBeInTheDocument()
    expect(screen.getByText('2 of 3 guests protected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Micro-segmentation' }))
    expect(onNavigateTab).toHaveBeenCalledWith(6)
  })

  it('asks the relay of the selected connection, once for each of the two readings', async () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 1 })
    await screen.findByText('Not deployed')

    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(urls.filter(u => u.endsWith('/status'))).toHaveLength(1)
    expect(urls.filter(u => u.endsWith('/policy'))).toHaveLength(1)
    expect(urls.every(u => u.includes('/microseg/conn-1/'))).toBe(true)
  })

  it('shows no card, and asks nothing, without a connection', async () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 1 }, { selectedConnection: '' })

    await waitFor(() => expect(screen.getByText('IN: DROP')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Open Micro-segmentation' })).not.toBeInTheDocument()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
