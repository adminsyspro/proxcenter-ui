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
import { forgetHeldEvents } from './usePostureEvents'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  try { window.localStorage.clear() } catch { /* no storage */ }
  forgetHeldEvents()
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
  events?: unknown[] | 'pending' | 'error'
  /** The persisted history route; absent = an orchestrator without it (404). */
  traffic?: { buckets: unknown[] } | 'error' | 'pending'
  pairs?: unknown[]
  sflowSeries?: unknown[] | 'error'
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
    if (url.startsWith('/api/v1/orchestrator/sflow?')) {
      if (url.includes('endpoint=ip-pairs')) return answer(over.pairs ?? [])
      if (over.sflowSeries === 'error') return answer({ error: 'InfluxDB not configured' }, 500)
      return answer(over.sflowSeries ?? [])
    }
    if (url.includes('/traffic?')) {
      if (over.traffic === 'pending') return pending()
      if (over.traffic === 'error') return answer({ code: 'NOT_LEADER', error: 'not the leader' }, 503)
      if (!over.traffic) return answer({ code: 'NOT_FOUND', error: 'no' }, 404)
      const q = new URL(url, 'http://x').searchParams
      return answer({ step: Number(q.get('step')), from: q.get('from'), to: q.get('to'), ...over.traffic })
    }
    if (url.includes('/events?')) {
      if (over.events === 'pending') return pending()
      if (over.events === 'error') return answer({ code: 'FEATURE_REQUIRED', error: 'enterprise' }, 403)
      const all = over.events ?? []
      const before = Number(new URL(url, 'http://x').searchParams.get('before_seq') ?? Infinity)
      const page = (all as { seq: number }[]).filter(e => e.seq < before).slice(0, 500)
      return answer({ events: page, truncated: false, oldest: null })
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

  it('lists the log reader of each node on hover of the last check chip, and adds no tooltip without log_nodes', async () => {
    const engine = { paused_until: null, held: false, last_log: null, cluster_firewall: 'enabled', last_runs: { light: { started_at: new Date(Date.now() - 2 * 60_000).toISOString(), status: 'done', api_calls: 1, writes: 0 } } }
    stubReads({ status: { engine, log_nodes: [{ node: 'pve1', lines_last: 400, lines_per_min_15m: 82, lag_seconds: 12, full_pages_24h: 0 }, { node: 'pve2', lines_last: 1, lines_per_min_15m: 3, lag_seconds: 300, full_pages_24h: 0 }] } })
    renderDashboard({ enable: 1, policy_in: 'DROP' })
    const chip = await screen.findByTestId('chip-check')
    fireEvent.mouseOver(chip)
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('pve1 · 82 lines/min · 12 s behind')
    expect(tip.textContent).toContain('pve2 · 3 lines/min · 5 min behind')
  })

  it('shows no tooltip on the last check chip when the status carries no log_nodes', async () => {
    stubReads({ status: { engine: { paused_until: null, held: false, last_log: null, cluster_firewall: 'enabled', last_runs: { light: { started_at: new Date(Date.now() - 2 * 60_000).toISOString(), status: 'done', api_calls: 1, writes: 0 } } } } })
    renderDashboard({ enable: 1, policy_in: 'DROP' })
    fireEvent.mouseOver(await screen.findByTestId('chip-check'))
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByRole('tooltip')).toBeNull()
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
    expect(screen.getByTestId('traffic-card-caption').textContent).toBe('hits of the pending observed flows · hits emitted per zone · unknown sources include the guests in no zone until the guest list is read (group by VLAN or node)')
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

    expect((await screen.findByTestId('traffic-card-caption')).textContent).toBe('hits of the first 200 pending observed flows · hits emitted per zone · unknown sources include the guests in no zone until the guest list is read (group by VLAN or node)')
  })

  it('says when there is no observed flow', async () => {
    postureReads({ suggestions: [] })
    renderDashboard({ enable: 1 })

    expect(await screen.findByTestId('traffic-empty')).toBeInTheDocument()
    expect(await screen.findByTestId('services-table')).toBeInTheDocument()
  })
})

let evSeq = 5000
/** An event of the ring, `minutesAgo` before now, from web to db unless told otherwise. */
const ev = (minutesAgo: number, over: Record<string, unknown> = {}) => ({
  seq: evSeq--, ts: new Date(Date.now() - minutesAgo * 60_000).toISOString(), node: 'pve2', vmid: 102, type: 'qemu', guest: 'db1', zone: 'db',
  src_zone: 'web', src_ip: '10.0.0.1', dst_ip: '10.0.0.2', proto: 'tcp', dport: 5432, verdict: 'would_block', ...over,
})

describe('DashboardTab: group by destination zone', () => {
  it('groups the donut and the chart by the zone that received the flows, says so, reads no guest list, and remembers it', async () => {
    postureReads({ events: [ev(0), ev(0), ev(0, { zone: 'web', src_zone: 'db' })] })
    renderDashboard({ enable: 1 })

    await screen.findByTestId('traffic-legend')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Group by' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Destination zone' }))

    // web to db 300, unknown to web 100, db to web 50: db received 300, web 150.
    const legend = await screen.findByTestId('traffic-legend')
    await waitFor(() => expect([...legend.querySelectorAll('[data-testid^="legend-"]')].filter(e => !e.getAttribute('data-testid')!.endsWith('-members')).map(e => e.getAttribute('data-testid'))).toEqual(['legend-zone:zdb', 'legend-zone:zweb']))
    expect(within(legend).getByTestId('legend-zone:zdb').textContent).toContain('300')
    expect(screen.getByText('Traffic by destination zone')).toBeTruthy()
    expect(screen.getByTestId('traffic-card-caption').textContent).toBe('hits of the pending observed flows · hits received per zone')
    await waitFor(() => expect(within(screen.getByTestId('timeline')).getAllByTestId(/^area-/).map(a => a.getAttribute('data-testid'))).toEqual(['area-zone:zdb', 'area-zone:zweb']))
    expect(fetchedUrls().some(u => u.startsWith('/api/v1/vms?'))).toBe(false)
    expect(window.localStorage.getItem('proxcenter.microseg.postureGroupBy')).toBe('dstzone')
  })
})

describe('DashboardTab: traffic over time', () => {
  it('stacks the events of the ring per 5 minutes under the donut and says the window the memory covers', async () => {
    postureReads({ events: [ev(0), ev(0, { verdict: 'blocked' }), ev(42, { src_zone: '', src_ip: '203.0.113.9' })] })
    renderDashboard({ enable: 1 })

    const caption = await screen.findByTestId('timeline-caption')
    expect(caption.textContent).toBe('covered window: last 42 min (orchestrator memory)')
    expect(within(screen.getByTestId('traffic-card')).getByTestId('timeline')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-max').textContent).toBe('2')
  })

  it('draws one stacked area per group, and on hover a guide at the nearest bucket with its breakdown', async () => {
    postureReads({ events: [ev(0), ev(0, { src_zone: '', src_ip: '203.0.113.9' }), ev(12)] })
    renderDashboard({ enable: 1 })

    await screen.findByTestId('timeline-caption')
    const timeline = screen.getByTestId('timeline')
    expect(within(timeline).getAllByTestId(/^area-/).map(g => g.getAttribute('data-testid'))).toEqual(['area-zone:zweb', 'area-external'])
    expect(within(timeline).getByTestId('area-zone:zweb').querySelectorAll('path')).toHaveLength(2)
    expect(within(timeline).queryByTestId('timeline-guide')).not.toBeInTheDocument()
    // Far right: the last bucket (the browser has no layout here, the pointer x is read in drawing units).
    fireEvent.mouseMove(screen.getByTestId('timeline-overlay'), { clientX: 10_000 })
    expect(screen.getByTestId('timeline-guide')).toBeInTheDocument()
    const tip = screen.getByTestId('timeline-tip')
    expect(tip.textContent).toContain('2 events')
    expect(tip.textContent).toContain('web')
    expect(tip.textContent).toContain('Unknown / External')
    fireEvent.mouseLeave(screen.getByTestId('timeline-overlay'))
    expect(screen.queryByTestId('timeline-tip')).not.toBeInTheDocument()
  })

  it('keeps the blocked events only from the verdict toggle', async () => {
    postureReads({ events: [ev(0), ev(0), ev(0, { verdict: 'blocked' })] })
    renderDashboard({ enable: 1 })

    await waitFor(() => expect(screen.getByTestId('timeline-max').textContent).toBe('3'))
    fireEvent.click(within(screen.getByTestId('timeline')).getByRole('button', { name: 'Blocked' }))
    await waitFor(() => expect(screen.getByTestId('timeline-max').textContent).toBe('1'))
  })

  it('reads up to 4 pages of 500 events, each below the previous', async () => {
    postureReads({ events: Array.from({ length: 2100 }, (_, i) => ev(i % 50)) })
    renderDashboard({ enable: 1 })

    await screen.findByTestId('timeline-caption')
    const reads = fetchedUrls().filter(u => u.includes('/microseg/conn-1/events?'))
    expect(reads).toHaveLength(4)
    expect(reads[0]).toMatch(/limit=500$/)
    expect(reads.slice(1).every(u => /before_seq=\d+/.test(u))).toBe(true)
    expect(fetchedUrls().some(u => /\/config$|\/api\/v1\/vms/.test(u))).toBe(false)
  })

  it('says when the memory holds no event, and when the events cannot be read', async () => {
    postureReads({ events: [] })
    renderDashboard({ enable: 1 })
    expect(await screen.findByTestId('timeline-empty')).toBeInTheDocument()
    cleanup()

    postureReads({ events: 'error' })
    renderDashboard({ enable: 1 })
    expect(await screen.findByTestId('timeline-unavailable')).toBeInTheDocument()
  })
})

describe('DashboardTab: time range (UA55)', () => {
  const chip = (range: string) => screen.getByTestId(`range-${range}`)
  const trafficUrls = () => fetchedUrls().filter(u => u.includes('/microseg/conn-1/traffic?'))
  const eventReads = () => fetchedUrls().filter(u => u.includes('/microseg/conn-1/events?'))
  /** A row of the history, `buckets` 5-minute buckets before the open one (the window ends at the next 5-minute edge). */
  const row = (buckets: number, over: Record<string, unknown> = {}) => ({
    at: new Date((Math.floor(Date.now() / 300_000) - buckets) * 300_000).toISOString(), zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 4, ...over,
  })

  it('reads the persisted history for the range, 1 h by default in steps of 300 s, and no event of the ring', async () => {
    postureReads({ traffic: { buckets: [row(0), row(0, { hits: 3, verdict: 'blocked' }), row(2, { src_zone: '', hits: 5 })] } })
    renderDashboard({ enable: 1 })

    await waitFor(() => expect(screen.getByTestId('timeline-max').textContent).toBe('7'))
    expect(screen.getByTestId('timeline-caption').textContent).toBe('history, last 1 h')
    const [url] = trafficUrls()
    const q = new URL(url, 'http://x').searchParams
    expect(q.get('step')).toBe('300')
    expect(Date.parse(q.get('to')!) - Date.parse(q.get('from')!)).toBeLessThanOrEqual(3_600_000)
    expect(within(screen.getByTestId('timeline')).getAllByTestId(/^area-/).map(g => g.getAttribute('data-testid'))).toEqual(['area-zone:zweb', 'area-external'])
    expect(eventReads()).toHaveLength(0)
    // The verdict toggle filters the history rows.
    fireEvent.click(within(screen.getByTestId('timeline')).getByRole('button', { name: 'Blocked' }))
    await waitFor(() => expect(screen.getByTestId('timeline-max').textContent).toBe('3'))
    expect(trafficUrls()).toHaveLength(1)
  })

  it('reads the steps of each range, and remembers the range per browser', async () => {
    postureReads({ traffic: { buckets: [row(0)] } })
    renderDashboard({ enable: 1 })
    await screen.findByTestId('timeline-caption')

    const steps: Record<string, string> = { '6h': '900', '24h': '1800', '7d': '10800' }
    for (const [range, step] of Object.entries(steps)) {
      fireEvent.click(chip(range))
      await waitFor(() => expect(trafficUrls().some(u => new URL(u, 'http://x').searchParams.get('step') === step)).toBe(true))
      expect(screen.getByTestId('timeline-caption').textContent).toBe(`history, last ${range === '7d' ? '7 d' : range.replace('h', ' h')}`)
    }
    expect(window.localStorage.getItem('proxcenter.microseg.postureRange')).toBe('7d')

    cleanup()
    renderDashboard({ enable: 1 })
    await screen.findByTestId('timeline-caption')
    expect(chip('7d')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('1h')).toHaveAttribute('aria-pressed', 'false')
    expect(trafficUrls().at(-1)).toContain('step=10800')
  })

  it('labels a week with the weekday', async () => {
    postureReads({ traffic: { buckets: [row(0)] } })
    renderDashboard({ enable: 1 })
    await screen.findByTestId('timeline-caption')
    fireEvent.click(chip('7d'))
    await waitFor(() => expect(trafficUrls().some(u => u.includes('step=10800'))).toBe(true))
    await waitFor(() => expect(screen.getByTestId('timeline-caption').textContent).toBe('history, last 7 d'))
    await waitFor(() => {
      const labels = [...screen.getByTestId('timeline').querySelectorAll('svg text')].map(n => n.textContent ?? '')
      expect(labels.some(l => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(l))).toBe(true)
    })
  })

  it('starts on an unknown stored value with the default range', async () => {
    window.localStorage.setItem('proxcenter.microseg.postureRange', '30d')
    postureReads({ traffic: { buckets: [row(0)] } })
    renderDashboard({ enable: 1 })
    await screen.findByTestId('timeline-caption')
    expect(chip('1h')).toHaveAttribute('aria-pressed', 'true')
  })

  it('falls back to the events of the ring, with the memory caption, when the history is not served', async () => {
    postureReads({ events: [ev(0), ev(42)] })
    renderDashboard({ enable: 1 })

    expect((await screen.findByTestId('timeline-caption')).textContent).toBe('covered window: last 42 min (orchestrator memory)')
    expect(trafficUrls().length).toBeGreaterThan(0)
    expect(eventReads().length).toBeGreaterThan(0)
    expect(chip('6h')).toBeDisabled()
    cleanup()

    postureReads({ events: [ev(0)], traffic: 'error' })
    renderDashboard({ enable: 1 })
    expect((await screen.findByTestId('timeline-caption')).textContent).toBe('covered window: last 1 min (orchestrator memory)')
    expect(screen.getByTestId('timeline-max').textContent).toBe('1')
  })

  it('says the history is not served on the disabled chips', async () => {
    postureReads({ events: [ev(0)] })
    renderDashboard({ enable: 1 })
    await screen.findByTestId('timeline-caption')
    fireEvent.mouseOver(screen.getByTestId('timeline-range-wrap'))
    expect(await screen.findByText('The history is not available on this orchestrator: showing the last events from its memory')).toBeInTheDocument()
  })

  it('keeps the events of the ring and disables the chips, with a tooltip, for a grouping by VLAN or node', async () => {
    postureReads({ traffic: { buckets: [row(0)] }, events: [ev(0)], vms: VMS })
    renderDashboard({ enable: 1 })
    await screen.findByTestId('timeline-caption')
    expect(eventReads()).toHaveLength(0)
    expect(chip('24h')).toBeEnabled()

    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Group by' }))
    fireEvent.click(await screen.findByRole('option', { name: 'VLAN' }))
    await waitFor(() => expect(screen.getByTestId('timeline-caption').textContent).toBe('covered window: last 1 min (orchestrator memory)'))
    expect(eventReads().length).toBeGreaterThan(0)
    for (const range of ['1h', '6h', '24h', '7d']) expect(chip(range)).toBeDisabled()
    fireEvent.mouseOver(screen.getByTestId('timeline-range-wrap'))
    expect(await screen.findByText('VLAN and node grouping use the orchestrator memory (last events only)')).toBeInTheDocument()

    // Back to the zones: the history again.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Group by' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Source zone' }))
    await waitFor(() => expect(screen.getByTestId('timeline-caption').textContent).toBe('history, last 1 h'))
    expect(chip('24h')).toBeEnabled()
  })

  it('says when the history holds no event in the range', async () => {
    postureReads({ traffic: { buckets: [] } })
    renderDashboard({ enable: 1 })
    expect((await screen.findByTestId('timeline-empty')).textContent).toBe('No observed event in this range')
  })

  it('follows the range on the Volume tab, with the InfluxDB window of the range, and keeps the chips on it for any grouping', async () => {
    const windowEnd = Math.floor(Date.now() / 3_600_000) * 3600 + 3600
    postureReads({
      traffic: { buckets: [row(0)] },
      pairs: [{ src_ip: '10.0.0.1', dst_ip: '10.0.0.2', src_vmid: 101, dst_vmid: 102, bytes: 1000, packets: 10, protocol: 'TCP', dst_port: 5432 }],
      sflowSeries: [{ vmid: 101, vm_name: 'web1', points: [{ time: windowEnd, bytes_in: 100, bytes_out: 2048 }] }],
    })
    renderDashboard({ enable: 1 })

    fireEvent.click(await screen.findByTestId('volume-tab'))
    expect(screen.getByTestId('timeline-caption').textContent).toBe('bytes sent per group, last 1 h (sFlow)')
    const series = () => fetchedUrls().filter(u => u.includes('endpoint=timeseries%2Fall-vms'))
    expect(series().at(-1)).toContain('granularity=5m')

    fireEvent.click(chip('7d'))
    await waitFor(() => expect(series().some(u => u.includes('granularity=1h'))).toBe(true))
    const q = new URL(series().at(-1)!, 'http://x').searchParams
    expect(Date.parse(q.get('to')!) - Date.parse(q.get('from')!)).toBeLessThanOrEqual(7 * 24 * 3_600_000)
    expect(Date.parse(q.get('to')!) - Date.parse(q.get('from')!)).toBeGreaterThan(7 * 24 * 3_600_000 - 3 * 3_600_000)
    expect(screen.getByTestId('timeline-caption').textContent).toBe('bytes sent per group, last 7 d (sFlow)')
    expect(chip('7d')).toBeEnabled()

    fireEvent.click(chip('6h'))
    await waitFor(() => expect(series().some(u => u.includes('granularity=15m'))).toBe(true))
  })
})

describe('DashboardTab: Volume (sFlow)', () => {
  const PAIRS = [{ src_ip: '10.0.0.1', dst_ip: '10.0.0.2', src_vmid: 101, dst_vmid: 102, bytes: 1000, packets: 10, protocol: 'TCP', dst_port: 5432 }]
  // InfluxDB stamps each 5-minute sum with the end of its window: the window holding now ends at the next edge.
  const windowEnd = (Math.floor(Date.now() / 300_000) + 1) * 300
  const SERIES = [
    { vmid: 101, vm_name: 'web1', points: [{ time: windowEnd, bytes_in: 100, bytes_out: 2048 }] },
    { vmid: 102, vm_name: 'db1', points: [{ time: windowEnd, bytes_in: 2048, bytes_out: 1024 }] },
  ]

  it('adds the Volume tab when sFlow has data for the connection: bytes sent per zone over the range (1 h by default)', async () => {
    postureReads({ events: [ev(0)], pairs: PAIRS, sflowSeries: SERIES })
    renderDashboard({ enable: 1 })

    fireEvent.click(await screen.findByTestId('volume-tab'))
    expect(screen.getByTestId('timeline-caption').textContent).toBe('bytes sent per group, last 1 h (sFlow)')
    expect(screen.getByTestId('timeline-max').textContent).toBe('3 KiB')
    expect(screen.getByRole('img', { name: 'sFlow bytes over time, stacked per group' })).toBeInTheDocument()
    const series = fetchedUrls().find(u => u.includes('endpoint=timeseries%2Fall-vms'))!
    expect(series).toContain('vmids=101%2C102')
    expect(series).toContain('granularity=5m')
    // The verdict toggle belongs to the events only.
    expect(within(screen.getByTestId('timeline')).queryByRole('button', { name: 'Blocked' })).not.toBeInTheDocument()
  })

  it('shows no Volume tab when sFlow sees none of the connection guests, and reads no time series then', async () => {
    postureReads({ events: [ev(0)], pairs: [{ ...PAIRS[0], src_vmid: 777, dst_vmid: 778 }], sflowSeries: SERIES })
    renderDashboard({ enable: 1 })

    await screen.findByTestId('timeline-caption')
    await waitFor(() => expect(fetchedUrls().some(u => u.includes('endpoint=ip-pairs'))).toBe(true))
    expect(screen.queryByTestId('volume-tab')).not.toBeInTheDocument()
    expect(fetchedUrls().some(u => u.includes('timeseries'))).toBe(false)
  })

  it('does not take another connection\'s VM with the same VMID once the guest addresses are known', async () => {
    postureReads({ events: [ev(0)], pairs: [{ ...PAIRS[0], src_ip: '172.16.0.1', dst_ip: '172.16.0.2' }], sflowSeries: SERIES, vms: VMS })
    renderDashboard({ enable: 1 })

    // Group by VLAN reads the guest addresses (10.0.0.1, 10.0.0.2): the pair's addresses are not theirs.
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Group by' }))
    fireEvent.click(await screen.findByRole('option', { name: 'VLAN' }))
    await screen.findByTestId('legend-vlan:20')
    await waitFor(() => expect(fetchedUrls().filter(u => u.includes('endpoint=ip-pairs')).length).toBeGreaterThan(0))
    expect(screen.queryByTestId('volume-tab')).not.toBeInTheDocument()
  })

  it('shows no Volume tab when the time series cannot be read', async () => {
    postureReads({ events: [ev(0)], pairs: PAIRS, sflowSeries: 'error' })
    renderDashboard({ enable: 1 })

    await waitFor(() => expect(fetchedUrls().some(u => u.includes('timeseries'))).toBe(true))
    expect(screen.queryByTestId('volume-tab')).not.toBeInTheDocument()
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
