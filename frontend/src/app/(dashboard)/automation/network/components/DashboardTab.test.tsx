/**
 * The dashboard's policy chips, score and "Policy IN permissive" advice read
 * the cluster policy, which PVE leaves unset until someone changes it and then
 * enforces as DROP inbound (#1065). The guest coverage comes from one server
 * route, and nothing is advised while the figures or the emergency stop state
 * are not in (UA44). No automatic RTL cleanup in this repo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'

import DashboardTab from './DashboardTab'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const COVERAGE = { total: 36, measured: 36, enabled: 20, disabled: 15, unknown: 1, sampled: false, partial: true, computedAt: new Date(Date.now() - 5 * 60_000).toISOString(), computing: false }

type Stub = {
  status?: Record<string, unknown> | 'pending'
  policy?: Record<string, unknown> | 'pending'
  coverage?: Record<string, unknown> | 'pending' | 'error'
}

const pending = () => new Promise<never>(() => {})

function stubMicrosegRelay(over: Stub = {}) {
  const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/v1/firewall/coverage/')) {
      if (over.coverage === 'pending') return pending()
      if (over.coverage === 'error') return answer({ error: 'HTTP 502' }, 502)
      const forced = url.includes('refresh=1')
      return answer({ ...COVERAGE, ...(over.coverage ?? {}), ...(forced ? { enabled: 21, disabled: 14 } : {}) })
    }
    if (url.endsWith('/status')) {
      if (over.status === 'pending') return pending()
      return answer({
        engine: { paused_until: null, held: false, last_runs: {}, last_log: null },
        coverage: { running: 5, zoned: 3, members: 3, protected: 2 },
        zones_by_state: { disabled: 0, observe: 0, enforce: 0 },
        emergency_stop: false,
        ...(over.status ?? {}),
      })
    }
    if (url.endsWith('/policy')) {
      if (over.policy === 'pending') return pending()
      return answer({
        policy: { id: 'p1', connection_id: 'conn-1', tag_prefix: 'zone-', version: 1, settings: {}, emergency_stop: false },
        zones: [], flows: [], pending_members: [], last_revision: null, version: 1, pending_changes: false,
        ...(over.policy ?? {}),
      })
    }
    return answer({ code: 'NOT_FOUND', error: 'no' }, 404)
  }))
}

const fetchedUrls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url))

function renderDashboard(
  clusterOptions: firewallAPIType.ClusterOptions | null,
  over: { selectedConnection?: string; connectionName?: string; onNavigateTab?: (tab: number) => void; loadError?: string | null; reload?: () => void; loading?: boolean } = {},
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
      firewallMode="cluster"
      currentOptions={clusterOptions}
      selectedConnection={over.selectedConnection ?? 'conn-1'}
      connectionName={over.connectionName}
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
  it('shows an unset policy as DROP in / ACCEPT out, with no permissive-policy advice', async () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 1 })

    expect(await screen.findByText('IN: DROP')).toBeInTheDocument()
    expect(screen.getByText('OUT: ACCEPT')).toBeInTheDocument()
    expect(screen.queryByText('Policy IN permissive')).not.toBeInTheDocument()
  })

  it('still flags an explicit ACCEPT inbound policy', async () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 1, policy_in: 'ACCEPT' })

    expect(await screen.findByText('IN: ACCEPT')).toBeInTheDocument()
    expect(await screen.findByText('Policy IN permissive')).toBeInTheDocument()
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

  it('shows the deployed state of a connection that has a last revision, and names the connection', async () => {
    stubMicrosegRelay({ policy: { last_revision: { id: 'r123', version: 123, author: 'me', created_at: '2026-11-02T09:00:00Z' }, version: 123 } })
    renderDashboard({ enable: 1 }, { connectionName: 'PVE-DR' })

    expect(await screen.findByText(/^Deployed/)).toBeInTheDocument()
    expect(screen.queryByText('Not deployed')).not.toBeInTheDocument()
    expect(screen.getByTestId('microseg-card-connection').textContent).toBe('PVE-DR')
  })

  it('asks the relay of the selected connection, once for each of the two readings', async () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 1 })
    await screen.findByText('Not deployed')

    const urls = fetchedUrls().filter(u => u.includes('/microseg/'))
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

describe('DashboardTab guest coverage (UA44)', () => {
  it('reads the server figures once, never a guest config, rules or options, and says when they were computed', async () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 1 })

    expect(await screen.findByText('Protected: 20/36')).toBeInTheDocument()
    expect(screen.getByText('Unprotected: 15')).toBeInTheDocument()
    expect(screen.getByText('1 guest not measured')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-caption').textContent).toMatch(/^Computed .*5 minutes ago/)

    const urls = fetchedUrls()
    expect(urls.filter(u => u.includes('/firewall/coverage/conn-1'))).toHaveLength(1)
    expect(urls.some(u => /\/config$|\/firewall\/vms\/|[?&]type=rules/.test(u))).toBe(false)
  })

  it('asks for new figures from the refresh button', async () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 1 })
    await screen.findByText('Protected: 20/36')

    fireEvent.click(screen.getByRole('button', { name: 'Compute again' }))

    expect(await screen.findByText('Protected: 21/36')).toBeInTheDocument()
    expect(fetchedUrls().filter(u => u.endsWith('/firewall/coverage/conn-1?refresh=1'))).toHaveLength(1)
  })

  it('says the figures are a sample above 200 guests', async () => {
    stubMicrosegRelay({ coverage: { total: 450, measured: 200, enabled: 120, disabled: 80, unknown: 0, sampled: true } })
    renderDashboard({ enable: 1 })

    expect(await screen.findByText(/sample of 200 guests out of 450/)).toBeInTheDocument()
  })

  it('says the coverage is not available when the server fails, and shows no score made of nothing', async () => {
    stubMicrosegRelay({ coverage: 'error' })
    renderDashboard({ enable: 1 })

    expect(await screen.findByText('Coverage not available: HTTP 502')).toBeInTheDocument()
    expect(screen.getByTestId('zero-trust-unavailable')).toBeInTheDocument()
    expect(screen.queryByText('/100')).not.toBeInTheDocument()
  })
})

describe('DashboardTab loading and emergency stop (UA44)', () => {
  it('shows one neutral skeleton while the coverage is computed, and no advice', async () => {
    stubMicrosegRelay({ coverage: 'pending' })
    renderDashboard({ enable: 0 })

    expect(await screen.findByTestId('firewall-loading-placeholder')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-loading')).toBeInTheDocument()
    expect(screen.getByTestId('recommendations-loading')).toBeInTheDocument()
    expect(screen.queryByText('/100')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recommendation-firewallOff')).not.toBeInTheDocument()
  })

  it('does not say "firewall disabled" while it cannot tell whether the emergency stop holds it off', async () => {
    stubMicrosegRelay({ status: 'pending' })
    renderDashboard({ enable: 0 })

    await screen.findByText('Protected: 20/36')
    expect(screen.getByTestId('recommendations-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('recommendation-firewallOff')).not.toBeInTheDocument()
  })

  it('says the emergency stop holds the cluster firewall off, with the way to resume, instead of "enable the firewall"', async () => {
    const onNavigateTab = vi.fn()
    stubMicrosegRelay({ status: { emergency_stop: true, engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'disabled' } } })
    renderDashboard({ enable: 0 }, { onNavigateTab })

    const tile = await screen.findByTestId('recommendation-stopHeld')
    expect(tile.textContent).toContain('Cluster firewall held off by the emergency stop')
    expect(tile.textContent).toContain('Resume from the Micro-segmentation tab')
    expect(screen.queryByTestId('recommendation-firewallOff')).not.toBeInTheDocument()

    fireEvent.click(within(tile).getByRole('button', { name: 'Open' }))
    expect(onNavigateTab).toHaveBeenCalledWith(6)
  })

  it('reads the stop from the policy flag when the engine cannot read the firewall', async () => {
    stubMicrosegRelay({
      status: { emergency_stop: true, engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'unknown' } },
      policy: { policy: { id: 'p1', connection_id: 'conn-1', tag_prefix: 'zone-', version: 1, settings: {}, emergency_stop: true, stop_cluster_disabled: true } },
    })
    renderDashboard({ enable: 0 })

    expect(await screen.findByTestId('recommendation-stopHeld')).toBeInTheDocument()
  })

  it('still says "firewall disabled" when no stop is involved', async () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 0 })

    expect(await screen.findByTestId('recommendation-firewallOff')).toBeInTheDocument()
    expect(screen.queryByTestId('recommendation-stopHeld')).not.toBeInTheDocument()
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

  it('shows one placeholder, never the wizard, while the firewall data is loading', async () => {
    stubMicrosegRelay()
    renderDashboard(null, { loading: true })

    expect(screen.getAllByTestId('firewall-loading-placeholder')).toHaveLength(1)
    expect(screen.queryByText('Cluster firewall not configured')).not.toBeInTheDocument()
    await screen.findByText('Protected: 20/36')
    expect(screen.getAllByTestId('firewall-loading-placeholder')).toHaveLength(1)
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

  it('shows the score again once the load succeeds', async () => {
    stubMicrosegRelay()
    renderDashboard({ enable: 1 })

    expect(await screen.findByText('/100')).toBeInTheDocument()
    expect(screen.queryByTestId('zero-trust-unavailable')).not.toBeInTheDocument()
  })
})
