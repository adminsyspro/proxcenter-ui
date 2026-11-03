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

function renderDashboard(
  clusterOptions: firewallAPIType.ClusterOptions | null,
  over: { selectedConnection?: string; onNavigateTab?: (tab: number) => void; loadError?: string | null; reload?: () => void; loading?: boolean } = {},
) {
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
      reload={over.reload ?? vi.fn()}
      loadError={over.loadError}
      loading={over.loading}
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

describe('DashboardTab load error', () => {
  it('warns instead of offering the deployment wizard when the load failed and left no cluster options', () => {
    stubMicrosegRelay()
    const reload = vi.fn()
    renderDashboard(null, { loadError: 'HTTP 502', reload })

    expect(screen.getByText(/Some firewall data could not be loaded.*HTTP 502/)).toBeInTheDocument()
    expect(screen.queryByText('Cluster firewall not configured')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not offer the wizard either when the options loaded but another list failed', () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 0 }, { loadError: 'HTTP 502' })

    expect(screen.getByText(/Some firewall data could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByText('Cluster firewall not configured')).not.toBeInTheDocument()
  })

  it('still offers the wizard on a virgin cluster that loaded', () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 0 })

    expect(screen.getByText('Cluster firewall not configured')).toBeInTheDocument()
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument()
  })

  it('shows a placeholder, never the wizard, while the firewall data is loading', () => {
    stubMicrosegRelay()
    renderDashboard(null, { loading: true })

    expect(screen.getByTestId('firewall-loading-placeholder')).toBeInTheDocument()
    expect(screen.queryByText('Cluster firewall not configured')).not.toBeInTheDocument()
  })

  it('shows no score nor advice computed from empty data when the load failed', () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 0 }, { loadError: 'HTTP 502' })

    expect(screen.getByTestId('zero-trust-unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('/100')).not.toBeInTheDocument()
    expect(screen.queryByText('Excellent')).not.toBeInTheDocument()
    expect(screen.queryByText('To improve')).not.toBeInTheDocument()
    expect(screen.queryByText('IN: DROP')).not.toBeInTheDocument()
    expect(screen.queryByText(/Firewall (OFF|ON)/)).not.toBeInTheDocument()
    expect(screen.queryByText('Policy IN permissive')).not.toBeInTheDocument()
    expect(screen.queryByText('Firewall disabled')).not.toBeInTheDocument()
  })

  it('shows the score again once the load succeeds', () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 1 })

    expect(screen.queryByTestId('zero-trust-unavailable')).not.toBeInTheDocument()
    expect(screen.getByText('/100')).toBeInTheDocument()
  })
})
