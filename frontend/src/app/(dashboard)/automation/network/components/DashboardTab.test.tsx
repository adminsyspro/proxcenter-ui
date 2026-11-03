/**
 * The "Posture" Dashboard of /automation/network (UA50): the header chips, the observed traffic by zone (donut, chords,
 * legend, group by), its distribution and top services, and the "To do" list with a way to each fix. The guest
 * coverage comes from one server route; the micro-segmentation reads are orchestrator memory; the guest list is read
 * only for a grouping by VLAN or node. Nothing is listed while its figures are not in, and the emergency stop is never
 * undone through the deployment wizard. No automatic RTL cleanup in this repo.
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
  suggestions?: unknown[] | 'pending' | 'error'
  vms?: unknown[] | 'pending'
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
    if (url.startsWith('/api/v1/vms?')) {
      if (over.vms === 'pending') return pending()
      return answer({ data: { vms: over.vms ?? [] } })
    }
    if (url.includes('/suggestions')) {
      if (over.suggestions === 'pending') return pending()
      if (over.suggestions === 'error') return answer({ code: 'FEATURE_REQUIRED', error: 'enterprise' }, 403)
      return answer({ suggestions: over.suggestions ?? [], limit: 200, offset: 0 })
    }
    return answer({ code: 'NOT_FOUND', error: 'no' }, 404)
  }))
}

let seq = 0
/** A pending observed flow to the db zone, from web unless told otherwise. */
const seen = (over: Record<string, unknown>) => ({
  id: `s${seq++}`, policy_id: 'p1', kind: 'would_block', src_key: 'zweb', src_ip: '10.0.0.1', src_zone_id: 'zweb', dst_ip: '10.0.0.2', dst_zone_id: 'zdb',
  proto: 'tcp', dport: '5432', hits: 10, first_seen: '2026-11-03T08:00:00Z', last_seen: '2026-11-03T09:00:00Z', status: 'pending', ...over,
})

const zone = (id: string, name: string, state: string, color: string) => ({
  id, policy_id: 'p1', name, label: '', color, enforcement: 'guest', vnet_id: '', state, isolate_members: false, observe_since: null,
})
const ZONES = [zone('zweb', 'web', 'observe', '#3b82f6'), zone('zdb', 'db', 'enforce', '#ef4444')]
const ALLOWED = [{ id: 'f1', policy_id: 'p1', src_zone_id: 'zweb', src_cidr: '', dst_zone_id: 'zdb', dst_cidr: '', proto: 'tcp', dport: '9100', comment: '', origin: 'manual', created_by: 'me' }]
/** web to db 300 hits on PostgreSQL, an unknown source 100 hits on SSH to web, db to web 50 blocked on HTTPS. */
const OBSERVED = [
  seen({ hits: 300 }),
  seen({ src_key: '203.0.113.9', src_ip: '203.0.113.9', src_zone_id: '', dst_ip: '10.0.0.1', dst_zone_id: 'zweb', dport: '22', hits: 100 }),
  seen({ src_key: 'zdb', src_ip: '10.0.0.2', src_zone_id: 'zdb', dst_ip: '10.0.0.1', dst_zone_id: 'zweb', dport: '443', hits: 50, kind: 'blocked' }),
]

const UNZONED_13 = Array.from({ length: 13 }, (_, i) => ({ kind: 'unzoned_running', guest: { type: 'lxc', vmid: 300 + i } }))

const fetchedUrls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url))

const MGMT_RULES: firewallAPIType.FirewallRule[] = [
  { pos: 0, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '8006', enable: 1 },
  { pos: 1, type: 'in', action: 'ACCEPT', macro: 'SSH', enable: 1 },
]

type Nav = { onNavigateTab?: (tab: number) => void; onNavigateRulesSubTab?: (sub: number) => void; onOpenGuests?: (f?: string) => void; onOpenMicroseg?: (s?: string) => void }

function renderDashboard(
  clusterOptions: firewallAPIType.ClusterOptions | null,
  over: Nav & { firewallMode?: firewallAPIType.FirewallMode; selectedConnection?: string; connectionName?: string; loadError?: string | null; reload?: () => void; loading?: boolean; clusterRules?: firewallAPIType.FirewallRule[] } = {},
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
      firewallMode={over.firewallMode ?? 'cluster'}
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

const POLICY = {
  policy: { id: 'p1', connection_id: 'conn-1', tag_prefix: 'zone-', version: 1, settings: {}, emergency_stop: false },
  zones: ZONES, flows: ALLOWED,
}
/** The coverage rows with zone tags: 2 guests in web (VLAN 10), 1 in db (VLAN 20). */
const TAGGED = [
  { ...row(101, 'running', true), type: 'qemu', tags: ['zone-web'], vlans: [10] },
  { ...row(102, 'running', true), type: 'qemu', node: 'pve2', tags: ['zone-db'], vlans: [20] },
  { ...row(103, 'stopped', false), type: 'qemu', tags: ['zone-web'], vlans: [10] },
]
const VMS = [
  { vmid: 101, name: 'web1', node: 'pve1', type: 'qemu', status: 'running', tags: ['zone-web'], ips: ['10.0.0.1'] },
  { vmid: 102, name: 'db1', node: 'pve2', type: 'qemu', status: 'running', tags: ['zone-db'], ips: ['10.0.0.2'] },
]
const postureReads = (over: Stub = {}) => stubReads({ policy: POLICY, suggestions: OBSERVED, coverage: { guests: TAGGED }, ...over })

describe('DashboardTab: header chips', () => {
  it('shows the cluster firewall with its inbound policy, the zones enforced, the running guests protected and the last check', async () => {
    stubReads({ status: { engine: { paused_until: null, held: false, last_log: null, cluster_firewall: 'enabled', last_runs: { light: { started_at: new Date(Date.now() - 2 * 60_000).toISOString(), status: 'done', api_calls: 1, writes: 0 } } } } })
    renderDashboard({ enable: 1, policy_in: 'DROP' })

    expect((await screen.findByTestId('chip-cluster')).textContent).toBe('Cluster firewall ON · IN DROP')
    expect((await screen.findByTestId('chip-zones')).textContent).toBe('Zones enforced 3 / 6')
    await waitFor(() => expect(screen.getByTestId('chip-guests').textContent).toBe('Guests protected 30 / 33 running'))
    await waitFor(() => expect(screen.getByTestId('chip-check').textContent).toMatch(/^Last check .*2 minutes ago/))
  })

  it('says "-" while the guests are not measured, and the host firewall in standalone mode', async () => {
    stubReads({ coverage: 'pending' })
    renderDashboard({ enable: 0, policy_in: 'ACCEPT' }, { firewallMode: 'standalone' })

    expect(screen.getByTestId('chip-guests').textContent).toBe('Guests protected -')
    expect(screen.getByTestId('chip-cluster').textContent).toBe('Host firewall OFF · IN ACCEPT')
  })

  it('opens the tab of each chip', async () => {
    stubReads()
    const onNavigateTab = vi.fn()
    const onNavigateRulesSubTab = vi.fn()
    const onOpenGuests = vi.fn()
    const onOpenMicroseg = vi.fn()
    renderDashboard({ enable: 1 }, { onNavigateTab, onNavigateRulesSubTab, onOpenGuests, onOpenMicroseg })

    fireEvent.click(await screen.findByTestId('chip-cluster'))
    expect(onNavigateTab).toHaveBeenCalledWith(1)
    expect(onNavigateRulesSubTab).toHaveBeenCalledWith(0)
    fireEvent.click(await screen.findByTestId('chip-zones'))
    expect(onOpenMicroseg).toHaveBeenCalledWith(undefined)
    fireEvent.click(screen.getByTestId('chip-guests'))
    expect(onOpenGuests).toHaveBeenCalledWith(undefined)
  })

  it('computes the coverage again from the button next to the guests chip, then holds it 30 s', async () => {
    stubReads()
    renderDashboard({ enable: 1 })

    const button = await screen.findByRole('button', { name: 'Compute the coverage again' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    await waitFor(() => expect(fetchedUrls().filter(u => u.endsWith('/firewall/coverage/conn-1?refresh=1'))).toHaveLength(1))
    // Figures just computed: the button holds for 30 s (the server would serve them from its cache anyway).
    await waitFor(() => expect((screen.getByRole('button', { name: 'Compute the coverage again' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('holds the refresh while the figures are less than 30 s old', async () => {
    stubReads({ coverage: { computedAt: new Date().toISOString() } })
    renderDashboard({ enable: 1 })

    await waitFor(() => expect(screen.getByTestId('chip-guests').textContent).toBe('Guests protected 30 / 33 running'))
    expect((screen.getByTestId('coverage-refresh') as HTMLButtonElement).disabled).toBe(true)
  })

  it('puts the emergency stop in red in place of the cluster chip, leading to Resume', async () => {
    const onOpenMicroseg = vi.fn()
    stubReads({ status: { emergency_stop: true, engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'enabled' } } })
    renderDashboard({ enable: 1 }, { onOpenMicroseg })

    const chip = await screen.findByTestId('chip-stop')
    expect(chip.textContent).toBe('Emergency stop active')
    expect(screen.queryByTestId('chip-cluster')).not.toBeInTheDocument()
    fireEvent.click(chip)
    expect(onOpenMicroseg).toHaveBeenCalledWith('overview')
  })
})

describe('DashboardTab: traffic by zone', () => {
  it('draws a slice per source zone with its legend: hits, guests, zone state; Unknown / External included', async () => {
    postureReads()
    renderDashboard({ enable: 1 })

    const legend = await screen.findByTestId('traffic-legend')
    const web = within(legend).getByTestId('legend-zone:zweb')
    expect(web.textContent).toContain('web')
    expect(web.textContent).toContain('300')
    expect(web.textContent).toContain('67%')
    expect(within(web).getByTestId('legend-zone:zweb-members').textContent).toBe('2 guests')
    expect(within(web).getByText('Observation')).toBeInTheDocument()
    expect(within(legend).getByTestId('legend-external').textContent).toContain('Unknown / External')
    expect(within(legend).getByTestId('legend-zone:zdb').textContent).toContain('Enforced')
    expect(screen.getByTestId('donut-total').textContent).toBe('450')
    expect(screen.getByTestId('slice-zone:zweb')).toBeInTheDocument()
    expect(screen.getByTestId('chord-zone:zweb>zone:zdb')).toBeInTheDocument()
    expect(screen.getByTestId('traffic-card-caption').textContent).toBe('hits of the pending observed flows · unknown sources include the guests in no zone until the guest list is read (group by VLAN or node)')
  })

  it('highlights a slice when its legend row is hovered', async () => {
    postureReads()
    renderDashboard({ enable: 1 })

    fireEvent.mouseEnter(await screen.findByTestId('legend-zone:zdb'))
    expect(screen.getByTestId('slice-zone:zweb').getAttribute('opacity')).toBe('0.3')
    expect(screen.getByTestId('slice-zone:zdb').getAttribute('opacity')).toBe('1')
    fireEvent.mouseLeave(screen.getByTestId('legend-zone:zdb'))
    expect(screen.getByTestId('slice-zone:zweb').getAttribute('opacity')).toBe('1')
  })

  it('reads no guest list for the zone grouping, and reads it to group by VLAN', async () => {
    postureReads({ vms: VMS })
    renderDashboard({ enable: 1 })

    await screen.findByTestId('traffic-legend')
    expect(fetchedUrls().some(u => u.startsWith('/api/v1/vms?'))).toBe(false)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Group by' }))
    fireEvent.click(await screen.findByRole('option', { name: 'VLAN' }))

    expect(await screen.findByTestId('legend-vlan:20')).toBeInTheDocument()
    expect(screen.getByText('Traffic by VLAN')).toBeInTheDocument()
    expect(screen.getByTestId('legend-vlan:20').textContent).toContain('VLAN 20')
    expect(fetchedUrls().filter(u => u === '/api/v1/vms?connId=conn-1')).toHaveLength(1)
    // The guest list is in: the caption no longer says the unknown sources hold the unzoned guests.
    expect(screen.getByTestId('traffic-card-caption').textContent).toBe('hits of the pending observed flows')
  })

  it('says the figures are those of the first 200 flows when the page is full', async () => {
    postureReads({ suggestions: Array.from({ length: 200 }, (_, i) => seen({ dport: String(1000 + i) })) })
    renderDashboard({ enable: 1 })

    expect((await screen.findByTestId('traffic-card-caption')).textContent).toBe('hits of the first 200 pending observed flows · unknown sources include the guests in no zone until the guest list is read (group by VLAN or node)')
  })

  it('says when there is no observed flow', async () => {
    postureReads({ suggestions: [] })
    renderDashboard({ enable: 1 })

    expect(await screen.findByTestId('traffic-empty')).toBeInTheDocument()
    expect(await screen.findByTestId('services-table')).toBeInTheDocument()
  })
})

describe('DashboardTab: observed traffic distribution and top services', () => {
  it('shows the five tiles, no "To outside" (never logged in v1)', async () => {
    postureReads()
    renderDashboard({ enable: 1 })

    expect((await screen.findByTestId('tile-east-west-value')).textContent).toBe('78%')
    expect(screen.getByTestId('tile-unknown-value').textContent).toBe('22%')
    expect(screen.queryByTestId('tile-outside')).not.toBeInTheDocument()
    expect(screen.getByTestId('tile-allowed-value').textContent).toBe('1 flow')
    expect(screen.getByTestId('tile-allowed').textContent).toContain('no counter')
    expect(screen.getByTestId('tile-would-block-value').textContent).toBe('2 flows')
    expect(screen.getByTestId('tile-blocked-value').textContent).toBe('1 flow')
    expect(screen.getByTestId('tile-blocked').textContent).toContain('in web')
  })

  it('lists the services by hits with their status, the allowed ones without counter', async () => {
    postureReads()
    renderDashboard({ enable: 1 })

    const table = await screen.findByTestId('services-table')
    const rows = within(table).getAllByRole('row').slice(1).map(r => r.textContent)
    expect(rows).toEqual(['PostgreSQL1300Not covered', 'SSH1100Not covered', 'HTTPS150Blocked', 'node-exporter1no counterAllowed'])
  })
})

describe('DashboardTab: skeletons', () => {
  it('shows one skeleton per block while loading', async () => {
    stubReads({ coverage: 'pending', status: 'pending', suggestions: 'pending' })
    renderDashboard(null, { loading: true })

    expect(screen.getByTestId('chip-cluster-loading')).toBeInTheDocument()
    expect(screen.getByTestId('chip-zones-loading')).toBeInTheDocument()
    expect(screen.getByTestId('chip-check-loading')).toBeInTheDocument()
    expect(screen.getByTestId('traffic-loading')).toBeInTheDocument()
    expect(screen.getByTestId('distribution-loading')).toBeInTheDocument()
    expect(screen.getByTestId('services-loading')).toBeInTheDocument()
    expect(screen.getByTestId('todo-loading')).toBeInTheDocument()
  })

  it('shows nothing and asks nothing without a connection', () => {
    stubReads()
    renderDashboard({ enable: 1 }, { selectedConnection: '' })

    expect(screen.queryByTestId('posture-chips')).not.toBeInTheDocument()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('reads the coverage once and nothing per guest from the browser', async () => {
    postureReads()
    renderDashboard({ enable: 1 })
    await screen.findByTestId('traffic-legend')

    const urls = fetchedUrls()
    expect(urls.filter(u => u.includes('/firewall/coverage/conn-1'))).toHaveLength(1)
    expect(urls.some(u => /\/config$|\/firewall\/vms\/|[?&]type=rules|\/api\/v1\/vms/.test(u))).toBe(false)
    expect(urls.filter(u => u.includes('/microseg/conn-1/suggestions'))).toHaveLength(1)
  })
})

describe('DashboardTab: To do', () => {
  it('lists every fix with its link: guests without firewall filtered, unzoned guests to Drifts, pending flows to Observation', async () => {
    const onOpenGuests = vi.fn()
    const onOpenMicroseg = vi.fn()
    stubReads({
      drifts: { drifts: UNZONED_13 },
      suggestions: [seen({}), seen({ dport: '22' })],
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

  it('says "at least 200" for a full page of pending flows', async () => {
    stubReads({ suggestions: Array.from({ length: 200 }, (_, i) => seen({ dport: String(1000 + i) })) })
    renderDashboard({ enable: 1 })

    expect((await screen.findByTestId('todo-pendingFlows')).textContent).toContain('At least 200 observed flows to review')
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
    expect(screen.getByTestId('chip-stop').textContent).toBe('Cluster firewall held off by the emergency stop')
    expect(screen.queryByTestId('chip-cluster')).not.toBeInTheDocument()

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

  it('names both administration ports in words when neither is let in', async () => {
    stubReads()
    renderDashboard({ enable: 1 }, { clusterRules: [] })

    expect((await screen.findByTestId('todo-managementRules')).textContent).toContain('(ports 8006 and 22)')
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

  it('takes an inbound REJECT for a deny: the chip says it, no To do line', async () => {
    stubReads()
    renderDashboard({ enable: 1, policy_in: 'REJECT' })

    expect((await screen.findByTestId('chip-cluster')).textContent).toBe('Cluster firewall ON · IN REJECT')
    await screen.findByTestId('todo-unprotected')
    expect(screen.queryByTestId('todo-policyIn')).not.toBeInTheDocument()
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

    await waitFor(() => expect(screen.getByTestId('chip-guests').textContent).toBe('Guests protected 30 / 33 running'))
    expect(screen.getByTestId('todo-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('todo-firewallOff')).not.toBeInTheDocument()
  })
})

describe('DashboardTab: load error', () => {
  it('keeps the load warning at the top and lists nothing', async () => {
    stubReads()
    const reload = vi.fn()
    renderDashboard(null, { loadError: 'HTTP 502', reload })

    expect(screen.getByText(/Some firewall data could not be loaded.*HTTP 502/)).toBeInTheDocument()
    expect(screen.getByTestId('chip-cluster').textContent).toBe('Cluster firewall not available')
    expect(screen.getByTestId('todo-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('todo-firewallOff')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('says the observed traffic is not available when the micro-segmentation cannot be read', async () => {
    stubReads({ suggestions: 'error' })
    renderDashboard({ enable: 1 })

    expect(await screen.findByTestId('traffic-unavailable')).toBeInTheDocument()
  })
})
