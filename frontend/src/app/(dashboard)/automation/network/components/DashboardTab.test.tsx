/**
 * The Dashboard tab of /automation/network (UA46): three state cards fed by one source each, the Zero Trust score on
 * their figures, and the "To do" list with a way to each fix. The guest coverage comes from one server route; the
 * micro-segmentation reads are orchestrator memory. Nothing is scored or listed while its figures are not in, and the
 * emergency stop is never undone through the deployment wizard. No automatic RTL cleanup in this repo.
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

const row = (vmid: number, status: string, enabled: boolean) => ({
  type: 'lxc', node: 'pve1', vmid: String(vmid), name: `ct${vmid}`, status, tags: [],
  enabled, optionsEnabled: enabled, nicFirewall: enabled, options: { enable: enabled ? 1 : 0 }, vlans: [],
})

/** The demo bench: 62 guests, 33 running, 36 containers protected by the engine, 26 guests without firewall. */
const GUESTS = [
  ...Array.from({ length: 36 }, (_, i) => row(100 + i, i < 30 ? 'running' : 'stopped', true)),
  ...Array.from({ length: 26 }, (_, i) => row(200 + i, i < 3 ? 'running' : 'stopped', false)),
]
const COVERAGE = {
  total: 62, measured: 62, enabled: 36, disabled: 26, unknown: 0, sampled: false, partial: false,
  computedAt: new Date(Date.now() - 5 * 60_000).toISOString(), computing: false, guests: GUESTS,
}

type Stub = {
  status?: Record<string, unknown> | 'pending'
  policy?: Record<string, unknown> | 'pending'
  coverage?: Record<string, unknown> | 'pending' | 'error'
  drifts?: Record<string, unknown> | 'pending'
  suggestions?: unknown[] | 'pending'
}

const pending = () => new Promise<never>(() => {})

function stubReads(over: Stub = {}) {
  const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/v1/firewall/coverage/')) {
      if (over.coverage === 'pending') return pending()
      if (over.coverage === 'error') return answer({ error: 'HTTP 502' }, 502)
      const forced = url.includes('refresh=1')
      return answer({ ...COVERAGE, ...(over.coverage ?? {}), ...(forced ? { enabled: 37, disabled: 25, computedAt: new Date().toISOString() } : {}) })
    }
    if (url.endsWith('/status')) {
      if (over.status === 'pending') return pending()
      return answer({
        engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'enabled' },
        coverage: { running: 33, zoned: 20, members: 33, protected: 6 },
        zones_by_state: { disabled: 1, observe: 2, enforce: 3 },
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
    if (url.endsWith('/drifts')) {
      if (over.drifts === 'pending') return pending()
      return answer({ drifts: [], computed: true, ...(over.drifts ?? {}) })
    }
    if (url.includes('/suggestions')) {
      if (over.suggestions === 'pending') return pending()
      return answer({ suggestions: over.suggestions ?? [], limit: 101, offset: 0 })
    }
    return answer({ code: 'NOT_FOUND', error: 'no' }, 404)
  }))
}

const UNZONED_13 = Array.from({ length: 13 }, (_, i) => ({ kind: 'unzoned_running', guest: { type: 'lxc', vmid: 300 + i } }))

const fetchedUrls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url))

const MGMT_RULES: firewallAPIType.FirewallRule[] = [
  { pos: 0, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '8006', enable: 1 },
  { pos: 1, type: 'in', action: 'ACCEPT', macro: 'SSH', enable: 1 },
]

type Nav = { onNavigateTab?: (tab: number) => void; onNavigateRulesSubTab?: (sub: number) => void; onOpenGuests?: (f?: string) => void; onOpenMicroseg?: (s?: string) => void }

function renderDashboard(
  clusterOptions: firewallAPIType.ClusterOptions | null,
  over: Nav & { selectedConnection?: string; connectionName?: string; loadError?: string | null; reload?: () => void; loading?: boolean; clusterRules?: firewallAPIType.FirewallRule[] } = {},
) {
  // The shared test provider does not read on mount; the page does.
  renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, refreshInterval: 0, provider: () => new Map() }}>
    <DashboardTab
      securityGroups={[{ group: 'web' }]}
      clusterOptions={clusterOptions}
      clusterRules={over.clusterRules ?? MGMT_RULES}
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
      onNavigateRulesSubTab={over.onNavigateRulesSubTab ?? vi.fn()}
      onOpenGuests={over.onOpenGuests}
      onOpenMicroseg={over.onOpenMicroseg}
    />
    </SWRConfig>,
  )
}

describe('DashboardTab: three state cards', () => {
  it('shows the cluster firewall, the micro-segmentation and the guest coverage on one row', async () => {
    stubReads({ drifts: { drifts: UNZONED_13 } })
    renderDashboard({ enable: 1, policy_in: 'DROP' }, { connectionName: 'PVE-DR' })

    const cluster = await screen.findByTestId('cluster-card')
    expect(within(cluster).getByTestId('cluster-state').textContent).toBe('On')
    expect(within(cluster).getByText('IN: DROP')).toBeInTheDocument()
    expect(within(cluster).getByText('OUT: ACCEPT')).toBeInTheDocument()
    expect(within(cluster).getByTestId('cluster-rules').textContent).toBe('2 cluster rules, 1 security group')

    const microseg = screen.getByTestId('microseg-card')
    expect(await within(microseg).findByText('6 of 33 zone members protected')).toBeInTheDocument()
    expect(within(microseg).getByText('13 running guests in no zone, of 33 running')).toBeInTheDocument()
    expect(within(microseg).getByText('Zones: 3 enforced, 2 observing, 1 disabled')).toBeInTheDocument()
    expect(within(microseg).getByText('13 drifts')).toBeInTheDocument()
    expect(within(microseg).getByTestId('microseg-card-subtitle').textContent).toBe('PVE-DR')

    const coverage = screen.getByTestId('coverage-card')
    expect(await within(coverage).findByText('36 protected of 62')).toBeInTheDocument()
    expect(within(coverage).getByTestId('coverage-states').textContent).toBe('33 running, 29 stopped')
    expect(within(coverage).getByText('26 without firewall')).toBeInTheDocument()
    expect(within(coverage).queryByText(/not read|not measured/)).not.toBeInTheDocument()
    expect(within(coverage).getByTestId('coverage-caption').textContent).toMatch(/^Computed .*5 minutes ago/)
  })

  it('reads the coverage once, never a guest config, rules or options from the browser', async () => {
    stubReads()
    renderDashboard({ enable: 1 })
    await screen.findByText('36 protected of 62')

    const urls = fetchedUrls()
    expect(urls.filter(u => u.includes('/firewall/coverage/conn-1'))).toHaveLength(1)
    expect(urls.some(u => /\/config$|\/firewall\/vms\/|[?&]type=rules/.test(u))).toBe(false)
    expect(urls.filter(u => u.endsWith('/microseg/conn-1/drifts'))).toHaveLength(1)
    expect(urls.filter(u => u.includes('/microseg/conn-1/suggestions'))).toHaveLength(1)
  })

  it('asks for new figures from the refresh button once the 30 s floor is over, not before', async () => {
    stubReads()
    renderDashboard({ enable: 1 })
    await screen.findByText('36 protected of 62')

    fireEvent.click(screen.getByRole('button', { name: 'Compute again' }))
    expect(await screen.findByText('37 protected of 62')).toBeInTheDocument()
    expect(fetchedUrls().filter(u => u.endsWith('/firewall/coverage/conn-1?refresh=1'))).toHaveLength(1)
    // Figures just computed: the button holds for 30 s (the server would serve them from its cache anyway).
    await waitFor(() => expect((screen.getByRole('button', { name: 'Compute again' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('says the figures are a sample above 200 guests', async () => {
    stubReads({ coverage: { total: 450, measured: 200, enabled: 120, disabled: 80, unknown: 0, sampled: true, guests: undefined } })
    renderDashboard({ enable: 1 })

    expect(await screen.findByText(/sample of 200 guests out of 450/)).toBeInTheDocument()
  })

  it('opens each card\'s tab', async () => {
    stubReads()
    const onNavigateTab = vi.fn()
    const onNavigateRulesSubTab = vi.fn()
    const onOpenGuests = vi.fn()
    const onOpenMicroseg = vi.fn()
    renderDashboard({ enable: 1 }, { onNavigateTab, onNavigateRulesSubTab, onOpenGuests, onOpenMicroseg })
    await screen.findByText('36 protected of 62')

    fireEvent.click(screen.getByRole('button', { name: 'Open the cluster firewall' }))
    expect(onNavigateTab).toHaveBeenCalledWith(1)
    expect(onNavigateRulesSubTab).toHaveBeenCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: 'Open Micro-segmentation' }))
    expect(onOpenMicroseg).toHaveBeenCalledWith(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Open the guest firewall' }))
    expect(onOpenGuests).toHaveBeenCalledWith(undefined)
  })

  it('shows one neutral skeleton per card while loading', async () => {
    stubReads({ coverage: 'pending', status: 'pending' })
    renderDashboard(null, { loading: true })

    expect(screen.getByTestId('cluster-card-loading')).toBeInTheDocument()
    expect(screen.getByTestId('microseg-card-loading')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-card-loading')).toBeInTheDocument()
    expect(screen.getByTestId('score-loading')).toBeInTheDocument()
    expect(screen.getByTestId('todo-loading')).toBeInTheDocument()
    expect(screen.queryByText('/100')).not.toBeInTheDocument()
  })

  it('shows nothing and asks nothing without a connection', () => {
    stubReads()
    renderDashboard({ enable: 1 }, { selectedConnection: '' })

    expect(screen.queryByTestId('cluster-card')).not.toBeInTheDocument()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})

describe('DashboardTab: Zero Trust score', () => {
  it('is computed on the figures of the cards, with its three components', async () => {
    stubReads()
    renderDashboard({ enable: 1, policy_in: 'DROP' })

    await waitFor(() => expect(screen.getByTestId('zero-trust-score').textContent).toBe('81'))
    expect(screen.getByTestId('zero-trust-band').textContent).toBe('Excellent')
    expect(screen.getByTestId('score-firewall').textContent).toContain('30/30')
    expect(screen.getByTestId('score-policyIn').textContent).toContain('25/25')
    expect(screen.getByTestId('score-coverage').textContent).toContain('58%')
    expect(screen.getByTestId('score-coverage').textContent).toContain('26/45')
  })

  it('lists the components and their values in the gauge tooltip', async () => {
    stubReads()
    renderDashboard({ enable: 1, policy_in: 'DROP' })
    await waitFor(() => expect(screen.getByTestId('zero-trust-score').textContent).toBe('81'))

    fireEvent.mouseOver(screen.getByTestId('zero-trust-gauge'))
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('Cluster firewall (On): 30 of 30')
    expect(tip.textContent).toContain('Inbound policy (DROP): 25 of 25')
    expect(tip.textContent).toContain('Guests protected (58%): 26 of 45')
  })

  it('says "Not computed" with a neutral gauge when no guest could be told apart', async () => {
    stubReads({ coverage: { enabled: 0, disabled: 0, unknown: 62 } })
    renderDashboard({ enable: 1 })

    await waitFor(() => expect(screen.getByTestId('zero-trust-band').textContent).toBe('Not computed'))
    expect(screen.getByTestId('zero-trust-score').textContent).toBe('-')
    expect(screen.queryByText('Excellent')).not.toBeInTheDocument()
    expect(screen.queryByText('To improve')).not.toBeInTheDocument()
  })

  it('says "Not computed" when the coverage cannot be read, and the coverage card says why', async () => {
    stubReads({ coverage: 'error' })
    renderDashboard({ enable: 1 })

    expect(await screen.findByText('Coverage not available: HTTP 502')).toBeInTheDocument()
    expect(screen.getByTestId('zero-trust-band').textContent).toBe('Not computed')
  })
})

describe('DashboardTab: To do', () => {
  it('lists every fix with its link: guests without firewall filtered, unzoned guests to Drifts, pending flows to Observation', async () => {
    const onOpenGuests = vi.fn()
    const onOpenMicroseg = vi.fn()
    stubReads({
      drifts: { drifts: UNZONED_13 },
      suggestions: [{ id: 's1' }, { id: 's2' }],
    })
    renderDashboard({ enable: 1, policy_in: 'DROP' }, { onOpenGuests, onOpenMicroseg })

    const unprotected = await screen.findByTestId('todo-unprotected')
    expect(unprotected.textContent).toContain('26 guests without firewall')
    fireEvent.click(within(unprotected).getByRole('button', { name: 'Show them' }))
    expect(onOpenGuests).toHaveBeenCalledWith('unprotected')

    const unzoned = screen.getByTestId('todo-unzoned')
    expect(unzoned.textContent).toContain('13 running guests in no zone')
    fireEvent.click(within(unzoned).getByRole('button', { name: 'Open Drifts' }))
    expect(onOpenMicroseg).toHaveBeenCalledWith('drifts')

    const flows = screen.getByTestId('todo-pendingFlows')
    expect(flows.textContent).toContain('2 observed flows to review')
    fireEvent.click(within(flows).getByRole('button', { name: 'Review them' }))
    expect(onOpenMicroseg).toHaveBeenCalledWith('observation')
  })

  it('says "more than 100" past the read limit', async () => {
    stubReads({ suggestions: Array.from({ length: 101 }, (_, i) => ({ id: `s${i}` })) })
    renderDashboard({ enable: 1 })

    expect((await screen.findByTestId('todo-pendingFlows')).textContent).toContain('More than 100 observed flows to review')
  })

  it('says the emergency stop holds the cluster firewall off, with Resume, and never offers the wizard', async () => {
    const onOpenMicroseg = vi.fn()
    stubReads({ status: { emergency_stop: true, engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'disabled' } } })
    renderDashboard({ enable: 0 }, { onOpenMicroseg, clusterRules: [] })

    const line = await screen.findByTestId('todo-stopHeld')
    expect(line.textContent).toContain('Cluster firewall held off by the emergency stop')
    expect(screen.queryByTestId('todo-firewallOff')).not.toBeInTheDocument()
    expect(screen.queryByTestId('todo-managementRules')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open the wizard' })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('cluster-card')).getByTestId('cluster-state').textContent).toBe('Cluster firewall held off by the emergency stop')

    fireEvent.click(within(line).getByRole('button', { name: 'Resume' }))
    expect(onOpenMicroseg).toHaveBeenCalledWith('overview')
  })

  it('reads the stop from the policy flag when the engine cannot read the firewall', async () => {
    stubReads({
      status: { emergency_stop: true, engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'unknown' } },
      policy: { policy: { id: 'p1', connection_id: 'conn-1', tag_prefix: 'zone-', version: 1, settings: {}, emergency_stop: true, stop_cluster_disabled: true } },
    })
    renderDashboard({ enable: 0 })

    expect(await screen.findByTestId('todo-stopHeld')).toBeInTheDocument()
  })

  it('offers the deployment wizard for a firewall that is off, outside a stop', async () => {
    stubReads({ status: { engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'disabled' } } })
    renderDashboard({ enable: 0 }, { clusterRules: [] })

    const line = await screen.findByTestId('todo-firewallOff')
    fireEvent.click(within(line).getByRole('button', { name: 'Open the wizard' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('says when no cluster rule lets the administration in', async () => {
    stubReads()
    renderDashboard({ enable: 1 }, { clusterRules: [{ pos: 0, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '8006', enable: 1 }] })

    expect((await screen.findByTestId('todo-managementRules')).textContent).toContain('(port 22)')
  })

  it('flags an explicit inbound ACCEPT policy and leads to the cluster options', async () => {
    stubReads()
    const onNavigateTab = vi.fn()
    const onNavigateRulesSubTab = vi.fn()
    renderDashboard({ enable: 1, policy_in: 'ACCEPT' }, { onNavigateTab, onNavigateRulesSubTab })

    const line = await screen.findByTestId('todo-policyIn')
    fireEvent.click(within(line).getByRole('button', { name: 'Change it' }))
    expect(onNavigateTab).toHaveBeenCalledWith(1)
    expect(onNavigateRulesSubTab).toHaveBeenCalledWith(0)
  })

  it('says "Nothing to do" when clean', async () => {
    stubReads({ coverage: { enabled: 62, disabled: 0, guests: GUESTS.map(g => ({ ...g, enabled: true })) }, status: { coverage: { running: 33, zoned: 33, members: 33, protected: 33 } } })
    renderDashboard({ enable: 1 })

    expect(await screen.findByTestId('todo-empty')).toBeInTheDocument()
    expect(screen.getByText('Nothing to do')).toBeInTheDocument()
  })

  it('lists nothing while the stop state or the micro-segmentation lists are not in', async () => {
    stubReads({ status: 'pending' })
    renderDashboard({ enable: 0 })

    await screen.findByText('36 protected of 62')
    expect(screen.getByTestId('todo-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('todo-firewallOff')).not.toBeInTheDocument()
  })
})

describe('DashboardTab: load error', () => {
  it('keeps the load warning at the top, scores nothing and lists nothing', async () => {
    stubReads()
    const reload = vi.fn()
    renderDashboard(null, { loadError: 'HTTP 502', reload })

    expect(screen.getByText(/Some firewall data could not be loaded.*HTTP 502/)).toBeInTheDocument()
    expect(screen.getByText('Firewall data not available')).toBeInTheDocument()
    expect(screen.getByTestId('todo-unavailable')).toBeInTheDocument()
    expect(screen.queryByText('IN: DROP')).not.toBeInTheDocument()
    expect(screen.queryByTestId('todo-firewallOff')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('zero-trust-band').textContent).toBe('Not computed'))

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
