/**
 * The "Posture" Dashboard of /automation/network (UA50): the observed traffic by zone (donut, chords, legend, group by,
 * timeline), its distribution, top services and top conversations, down to the bottom of the page. The guest
 * coverage comes from one server route; the micro-segmentation reads are orchestrator memory; the guest list is read
 * only for a grouping by VLAN or node. Nothing is listed while its figures are not in.
 * No automatic RTL cleanup in this repo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'
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
  /** The coverage of one connection (a cluster of a shared policy), over `coverage`. */
  coverageBy?: Record<string, Record<string, unknown> | 'error'>
  /** Holds the coverage of a connection until the promise settles (a slow cluster). */
  coverageGate?: Record<string, Promise<unknown>>
  /** Holds the history of a connection until the promise settles. */
  trafficGate?: Record<string, Promise<unknown>>
  /** The status of one connection, over `status`. */
  statusBy?: Record<string, Record<string, unknown>>
  drifts?: Record<string, unknown> | 'pending'
  suggestions?: unknown[] | 'pending' | 'error'
  vms?: unknown[] | 'pending'
  /** The guest list of one connection (a cluster of a shared policy), over `vms`. */
  vmsBy?: Record<string, unknown[]>
  /** Holds the guest list of a connection until the promise settles (a slow cluster). */
  vmsGate?: Record<string, Promise<unknown>>
  events?: unknown[] | 'pending' | 'error'
  /** The persisted history route; absent = an orchestrator without it (404). */
  traffic?: { buckets: unknown[] } | 'error' | 'pending'
  /** The history of one connection, over `traffic`. */
  trafficBy?: Record<string, { buckets: unknown[] } | 'error'>
  pairs?: unknown[]
  sflowSeries?: unknown[] | 'error'
}

const pending = () => new Promise<never>(() => {})

function stubReads(over: Stub = {}) {
  const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const connOf = (marker: string) => decodeURIComponent(url.split(marker)[1]?.split(/[/?]/)[0] ?? '')
    if (url.includes('/api/v1/firewall/coverage/')) {
      const own = over.coverageBy?.[connOf('/api/v1/firewall/coverage/')]
      if (over.coverage === 'pending') return pending()
      const gate = over.coverageGate?.[connOf('/api/v1/firewall/coverage/')]
      if (gate) await gate
      if (over.coverage === 'error' || own === 'error') return answer({ error: 'HTTP 502' }, 502)
      const forced = url.includes('refresh=1')
      return answer({ ...COVERAGE, ...(over.coverage ?? {}), ...(own ?? {}), ...(forced ? { enabled: 37, disabled: 25, computedAt: new Date().toISOString() } : {}) })
    }
    if (url.endsWith('/status')) {
      if (over.status === 'pending') return pending()
      return answer({
        engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: 'enabled' },
        coverage: { running: 33, zoned: 20, members: 33, protected: 6 },
        zones_by_state: { disabled: 1, observe: 2, enforce: 3 },
        emergency_stop: false,
        ...(over.status ?? {}),
        ...(over.statusBy?.[connOf('/microseg/')] ?? {}),
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
      const traffic = over.trafficBy?.[connOf('/microseg/')] ?? over.traffic
      const trafficGate = over.trafficGate?.[connOf('/microseg/')]
      if (trafficGate) await trafficGate
      if (traffic === 'pending') return pending()
      if (traffic === 'error') return answer({ code: 'NOT_LEADER', error: 'not the leader' }, 503)
      if (!traffic) return answer({ code: 'NOT_FOUND', error: 'no' }, 404)
      const q = new URL(url, 'http://x').searchParams
      return answer({ step: Number(q.get('step')), from: q.get('from'), to: q.get('to'), ...traffic })
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
      const connId = new URL(url, 'http://x').searchParams.get('connId') ?? ''
      if (over.vmsGate?.[connId]) await over.vmsGate[connId]
      const own = over.vmsBy?.[connId]
      return answer({ data: { vms: own ?? over.vms ?? [] } })
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
  over: Nav & { firewallMode?: firewallAPIType.FirewallMode; selectedConnection?: string; connectionName?: string; loadError?: string | null; reload?: () => void; loading?: boolean; clusterRules?: firewallAPIType.FirewallRule[]; connections?: { id: string; name: string }[] } = {},
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
      connections={over.connections}
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

describe('DashboardTab: no posture chips', () => {
  it('shows no posture chips and reads no engine status', async () => {
    postureReads()
    renderDashboard({ enable: 1, policy_in: 'DROP' })
    await screen.findByTestId('traffic-legend')

    expect(screen.queryByTestId('posture-chips')).not.toBeInTheDocument()
    expect(document.querySelector('[data-testid^="chip-"]')).toBeNull()
    expect(fetchedUrls().some(u => u.endsWith('/microseg/conn-1/status'))).toBe(false)
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
    expect(screen.getByTestId('traffic-card-caption').textContent).toBe('hits emitted per zone')
    // What the short caption leaves out is behind the information icon.
    expect(screen.getByTestId('traffic-card-hint').getAttribute('aria-label')).toBe('hits of the pending observed flows · unknown sources include the guests in no zone until the guest list is read (group by VLAN or node)')
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
    expect(screen.queryByTestId('traffic-card-hint')).toBeNull()
  })

  it('says the figures are those of the first 200 flows when the page is full', async () => {
    postureReads({ suggestions: Array.from({ length: 200 }, (_, i) => seen({ dport: String(1000 + i) })) })
    renderDashboard({ enable: 1 })

    expect((await screen.findByTestId('traffic-card-hint')).getAttribute('aria-label')).toBe('hits of the first 200 pending observed flows · unknown sources include the guests in no zone until the guest list is read (group by VLAN or node)')
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
    expect(screen.getByTestId('traffic-card-caption').textContent).toBe('hits received per zone')
    expect(screen.getByTestId('traffic-card-hint').getAttribute('aria-label')).toBe('hits of the pending observed flows')
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
    // A dot on each group's line at the hovered bucket, the card beside the guide (here left of it, at the right edge).
    expect(screen.getAllByTestId('timeline-dot').length).toBeGreaterThanOrEqual(2)
    const guideX = Number(screen.getByTestId('timeline-guide').getAttribute('x1'))
    expect(Number.parseFloat(getComputedStyle(tip).left) + 240).toBeLessThanOrEqual(guideX)
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
    // The toggle reads nothing again: no window is fetched twice. Counting the
    // reads would fail whenever the run straddles a 5-minute edge, where the
    // window itself moves and a second, different read is legitimate.
    expect(new Set(trafficUrls()).size).toBe(trafficUrls().length)
    expect(trafficUrls().every(u => new URL(u, 'http://x').searchParams.get('step') === '300')).toBe(true)
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

  it('words a blocked outbound flow with the zone that emits it, next to the zones that blocked inbound traffic', async () => {
    const blockedOut = seen({ direction: 'out', kind: 'blocked', src_key: 'zweb', src_zone_id: 'zweb', src_ip: '', dst_zone_id: 'zdb', dst_key: 'zdb', dst_ip: '10.0.0.2', dport: '53', proto: 'udp', hits: 9 })
    postureReads({ suggestions: [...OBSERVED, blockedOut, { ...blockedOut, id: 'o2', dport: '443', proto: 'tcp' }] })
    renderDashboard({ enable: 1 })

    expect(await screen.findByTestId('tile-blocked-value')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('tile-blocked-value').textContent).toBe('3 flows'))
    const caption = screen.getByTestId('tile-blocked').textContent ?? ''
    expect(caption).toContain('in web')
    expect(caption).toContain('outbound from web')
    expect(caption).not.toContain('in db')
  })

  it('lists the services by hits with their status, the allowed ones without counter', async () => {
    postureReads()
    renderDashboard({ enable: 1 })

    const table = await screen.findByTestId('services-table')
    const rows = within(table).getAllByRole('row').slice(1).map(r => r.textContent)
    expect(rows).toEqual(['PostgreSQL1300Would be blocked', 'SSH1100Would be blocked', 'HTTPS150Blocked', 'node-exporter1no counterAllowed'])
  })

  it('opens what a figure counts: a tile of flows, the name of a service, one of its statuses', async () => {
    postureReads()
    const onOpenMicroseg = vi.fn()
    renderDashboard({ enable: 1 }, { onOpenMicroseg })

    fireEvent.click(await screen.findByTestId('tile-would-block'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation', { kind: 'would_block' })
    fireEvent.click(screen.getByTestId('tile-blocked'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation', { kind: 'blocked' })
    fireEvent.click(screen.getByTestId('tile-allowed'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('policy')
    fireEvent.click(screen.getByTestId('tile-unknown'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation', { source: 'unknown' })
    // The east-west share is not a list of flows the Observation can be filtered on: nothing to open.
    expect(screen.getByTestId('tile-east-west').tagName).toBe('DIV')

    fireEvent.click(screen.getByTestId('service-open-SSH'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation', { service: { label: 'SSH', tokens: ['tcp/22'] }, kind: undefined })
    fireEvent.click(within(screen.getByTestId('service-HTTPS')).getByTestId('service-part-blocked'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation', { service: { label: 'HTTPS', tokens: ['tcp/443'] }, kind: 'blocked' })
    // A service the policy only allows has no observed flow to list: its status opens the Policy, its name nothing.
    expect(screen.queryByTestId('service-open-node-exporter')).toBeNull()
    fireEvent.click(within(screen.getByTestId('service-node-exporter')).getByTestId('service-part-allowed'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('policy')
  })

  it('opens the observed flows of a zone, or of the unknown sources, from the legend of the donut', async () => {
    postureReads()
    const onOpenMicroseg = vi.fn()
    renderDashboard({ enable: 1 }, { onOpenMicroseg })

    fireEvent.click(await screen.findByTestId('open-legend-zone:zweb'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation', { zoneId: 'zweb' })
    fireEvent.click(screen.getByTestId('open-legend-external'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation', { source: 'unknown' })
  })

  it('says why the allowed flows have no counter, on hover', async () => {
    postureReads()
    renderDashboard({ enable: 1 })

    fireEvent.mouseOver(within(await screen.findByTestId('tile-allowed')).getByText('no counter'))
    expect(await screen.findByText('The flows the policy allows are not logged, so their hits are not counted.')).toBeInTheDocument()
  })

  it('links to every observed flow under the services, and says how many services the table leaves out', async () => {
    postureReads({ suggestions: Array.from({ length: 11 }, (_, i) => seen({ dport: String(40000 + i), hits: 100 - i })) })
    const onOpenMicroseg = vi.fn()
    renderDashboard({ enable: 1 }, { onOpenMicroseg })

    const footer = await screen.findByTestId('services-footer')
    // 11 observed ports and the allowed node-exporter: 12 services, 8 shown.
    expect(footer.textContent).toContain('8 of 12 services')
    fireEvent.click(within(footer).getByTestId('services-all'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation')
  })

  it('says nothing of the services left out when the table shows them all', async () => {
    postureReads()
    renderDashboard({ enable: 1 })

    const footer = await screen.findByTestId('services-footer')
    expect(footer.textContent).toBe('All observed flows')
  })

  it('writes the hits of each status in a service seen under two of them', async () => {
    postureReads({ suggestions: [seen({ dport: '22', hits: 2000 }), seen({ dport: '22', hits: 300, kind: 'blocked', src_ip: '10.9.9.9' })] })
    renderDashboard({ enable: 1 })

    const row = await screen.findByTestId('service-SSH')
    expect(within(row).getByTestId('service-part-not_covered').textContent).toBe('Would be blocked · 2K')
    expect(within(row).getByTestId('service-part-blocked').textContent).toBe('Blocked · 300')
  })
})

describe('DashboardTab: skeletons', () => {
  it('shows one skeleton per block while loading', async () => {
    stubReads({ coverage: 'pending', status: 'pending', suggestions: 'pending' })
    renderDashboard(null, { loading: true })

    expect(screen.getByTestId('traffic-loading')).toBeInTheDocument()
    expect(screen.getByTestId('distribution-loading')).toBeInTheDocument()
    expect(screen.getByTestId('services-loading')).toBeInTheDocument()
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

describe('DashboardTab: top conversations', () => {
  it('lists who talks to whom, the busiest first, and opens the Observation on the zone a pair enters', async () => {
    const onOpenMicroseg = vi.fn()
    postureReads()
    renderDashboard({ enable: 1 }, { onOpenMicroseg })

    await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('conversation-row')
    expect(rows.map(r => within(r).getByTestId('conversation-source').textContent)).toEqual(['web', '203.0.113.9', 'db'])
    expect(rows.map(r => within(r).getByTestId('conversation-destination').textContent)).toEqual(['db', 'web', 'web'])
    expect(within(rows[0]).getByTestId('conversation-services').textContent).toBe('PostgreSQL')
    expect(within(rows[0]).getByTestId('conversation-way-in')).toBeInTheDocument()
    expect(within(rows[2]).getByTestId('conversation-part-blocked').textContent).toBe('Blocked')

    fireEvent.click(rows[1])
    expect(onOpenMicroseg).toHaveBeenCalledWith('observation', { zoneId: 'zweb' })
    fireEvent.click(screen.getByTestId('conversations-all'))
    expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation')
  })

  it('says when there is no observed flow to review', async () => {
    stubReads({ policy: POLICY, suggestions: [] })
    renderDashboard({ enable: 1 })

    expect(await screen.findByTestId('conversations-empty')).toBeInTheDocument()
  })
})

describe('DashboardTab: a policy shared by several clusters', () => {
  const link = (connection_id: string) => ({ connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null })
  const SHARED = { ...POLICY, clusters: [link('conn-1'), link('conn-2')] }
  const SHARED3 = { ...POLICY, clusters: [link('conn-1'), link('conn-2'), link('conn-3')] }
  const CONNECTIONS = [{ id: 'conn-1', name: 'PVE-PROD' }, { id: 'conn-2', name: 'PVE-DR' }, { id: 'conn-3', name: 'PVE-LAB3' }]
  /** web-dr is a member of web on the other cluster. */
  const DR_VMS = [{ vmid: 101, name: 'web-dr', node: 'pve9', type: 'qemu', status: 'running', tags: ['zone-web'], ips: ['10.8.0.1'] }]
  /** The coverage rows of PVE-DR: one guest in web, with the same VMID as a guest of PVE-PROD. */
  const DR_TAGGED = [{ ...row(101, 'running', true), type: 'qemu', node: 'pve9', tags: ['zone-web'], vlans: [10] }]
  /** Logged on conn-1 (no cluster on the row: older data, read through conn-1): web-dr (conn-2) to db, the engine put its source in web. */
  const FROM_DR = seen({ src_ip: '10.8.0.1', hits: 500 })
  /** Logged on PVE-DR: web to db 200 hits, an unknown source 40 hits on SSH to web. */
  const DR_OBSERVED = [
    seen({ src_ip: '10.8.0.5', dst_ip: '10.8.0.6', hits: 200, connection_id: 'conn-2' }),
    seen({ src_key: '198.51.100.7', src_ip: '198.51.100.7', src_zone_id: '', dst_ip: '10.8.0.5', dst_zone_id: 'zweb', dport: '22', hits: 40, connection_id: 'conn-2' }),
  ]
  const microsegUrls = () => fetchedUrls().filter(u => u.includes('/microseg/'))
  const coverageUrls = () => fetchedUrls().filter(u => u.includes('/firewall/coverage/'))
  const legendOf = (key: string) => within(screen.getByTestId('traffic-legend')).getByTestId(`legend-${key}`)
  const tile = (name: string) => screen.getAllByTestId('cluster-tile').find(t => t.getAttribute('data-cluster') === name)!

  it('reads the observed flows once for the whole policy, and adds up the figures and the guests of a zone on every cluster', async () => {
    postureReads({ policy: SHARED, suggestions: [...OBSERVED, ...DR_OBSERVED], coverageBy: { 'conn-2': { guests: DR_TAGGED } } })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS.slice(0, 2) })

    await waitFor(() => expect(screen.getByTestId('donut-total').textContent).toBe('690'))
    expect(legendOf('zone:zweb').textContent).toContain('500')
    // Two web guests on PVE-PROD and one on PVE-DR, though two of them have the same VMID.
    expect(within(legendOf('zone:zweb')).getByTestId('legend-zone:zweb-members').textContent).toBe('3 guests')
    expect(screen.getByTestId('service-PostgreSQL').textContent).toContain('500')
    expect(screen.getByTestId('tile-would-block-value').textContent).toBe('4 flows')

    // One read of the observed flows for the whole policy, through the selected connection, never per cluster.
    expect(microsegUrls().filter(u => u.includes('/suggestions'))).toEqual(['/api/v1/firewall/microseg/conn-1/suggestions?status=pending&limit=200'])
    // The coverage of each cluster, once.
    await waitFor(() => expect(coverageUrls().sort()).toEqual(['/api/v1/firewall/coverage/conn-1', '/api/v1/firewall/coverage/conn-2']))
  })

  it('aggregates three clusters: the conversations of one pair add up, and a member of another cluster keeps its cluster chip', async () => {
    const LAB3 = [
      seen({ src_ip: '10.9.0.5', dst_ip: '10.9.0.6', hits: 100, connection_id: 'conn-3' }),
      // Logged on PVE-LAB3, from web-dr of PVE-DR.
      seen({ src_ip: '10.8.0.1', dst_ip: '10.9.0.6', hits: 70, connection_id: 'conn-3', dport: '5433' }),
    ]
    postureReads({ policy: SHARED3, suggestions: [...OBSERVED, ...DR_OBSERVED, ...LAB3], vmsBy: { 'conn-2': DR_VMS } })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS })

    await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(5))
    const rows = screen.getAllByTestId('conversation-row')
    // web to db on the three clusters: 300 + 200 + 100.
    expect(rows[0].textContent).toContain('600')
    expect(within(rows[0]).queryByTestId('conversation-peer-cluster')).toBeNull()
    const peer = rows.find(r => within(r).queryByTestId('conversation-peer-cluster'))!
    expect(within(peer).getByTestId('conversation-peer-cluster').textContent).toBe('PVE-DR')
    expect(peer.textContent).toContain('70')
    expect(screen.getByTestId('donut-total').textContent).toBe('860')
    expect(screen.getAllByTestId('cluster-tile').map(t => t.getAttribute('data-cluster'))).toEqual(['PVE-DR', 'PVE-LAB3', 'PVE-PROD'])
    await waitFor(() => expect(coverageUrls().sort()).toEqual(['conn-1', 'conn-2', 'conn-3'].map(id => `/api/v1/firewall/coverage/${id}`)))
    // The guests of each cluster, once (the conversations name a member of another cluster).
    expect(['conn-1', 'conn-2', 'conn-3'].map(id => fetchedUrls().filter(u => u === `/api/v1/vms?connId=${id}`).length)).toEqual([1, 1, 1])
  })

  it('never shows the guests of a zone as a total while a linked cluster is still read: no count, then the whole', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    postureReads({ policy: SHARED, suggestions: [...OBSERVED, ...DR_OBSERVED], coverageBy: { 'conn-2': { guests: DR_TAGGED } }, coverageGate: { 'conn-2': gate } })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS.slice(0, 2) })

    await waitFor(() => expect(screen.getByTestId('donut-total').textContent).toBe('690'))
    await waitFor(() => expect(coverageUrls()).toHaveLength(2))
    // PVE-PROD answered (2 web guests): the sum of what arrived is not the total, the count waits.
    expect(screen.queryByTestId('legend-zone:zweb-members')).toBeNull()
    await act(async () => { release() })
    await waitFor(() => expect(within(legendOf('zone:zweb')).getByTestId('legend-zone:zweb-members').textContent).toBe('3 guests'))
  })

  it('counts a cluster that failed as read: the guests of the others show, its tile says its figures are missing', async () => {
    postureReads({ policy: SHARED, suggestions: [...OBSERVED, ...DR_OBSERVED], coverageBy: { 'conn-2': 'error' } })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS.slice(0, 2) })

    await waitFor(() => expect(within(legendOf('zone:zweb')).getByTestId('legend-zone:zweb-members').textContent).toBe('2 guests'))
    expect(tile('PVE-DR').dataset.missing).toBe('true')
  })

  it('holds the chart of the traffic over time until the history of every linked cluster answered', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const now = new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString()
    const bucket = (hits: number) => ({ buckets: [{ at: now, zone: 'db', src_zone: 'web', verdict: 'would_block', hits }] })
    postureReads({ policy: SHARED, trafficBy: { 'conn-1': bucket(4), 'conn-2': bucket(6) }, trafficGate: { 'conn-2': gate } })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS.slice(0, 2) })

    await screen.findByTestId('timeline-loading')
    await waitFor(() => expect(fetchedUrls().filter(u => u.includes('/traffic?'))).toHaveLength(2))
    expect(screen.queryByTestId('timeline-max')).toBeNull()
    await act(async () => { release() })
    await waitFor(() => expect(screen.getByTestId('timeline-max').textContent).toBe('10'))
  })

  it('reads the coverage of two clusters at a time at most', async () => {
    postureReads({ policy: SHARED3, coverage: 'pending' })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS })

    await screen.findByTestId('cluster-strip')
    await waitFor(() => expect(fetchedUrls().filter(u => u.startsWith('/api/v1/vms?'))).toHaveLength(3))
    expect(coverageUrls().sort()).toEqual(['/api/v1/firewall/coverage/conn-1', '/api/v1/firewall/coverage/conn-2'])
  })

  it('filters every block on the cluster of a tile, and back on the whole policy, without reading anything again', async () => {
    postureReads({
      policy: SHARED, suggestions: [...OBSERVED, ...DR_OBSERVED], coverageBy: { 'conn-2': { guests: DR_TAGGED } },
      trafficBy: { 'conn-1': { buckets: [{ at: new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString(), zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 4 }] }, 'conn-2': { buckets: [{ at: new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString(), zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 6 }] } },
    })
    const onOpenMicroseg = vi.fn()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderDashboard({ enable: 1 }, { connections: CONNECTIONS.slice(0, 2), onOpenMicroseg })
      await waitFor(() => expect(screen.getByTestId('timeline-max').textContent).toBe('10'))
      await waitFor(() => expect(screen.getByTestId('donut-total').textContent).toBe('690'))
      await waitFor(() => expect(coverageUrls()).toHaveLength(2))
      // Past the deduping window of every read: a read asked again now would go out.
      await act(async () => { vi.advanceTimersByTime(6000) })
      const reads = vi.mocked(fetch).mock.calls.length
      expect(screen.getByTestId('cluster-tile-all').dataset.selected).toBe('true')

      fireEvent.click(within(tile('PVE-DR')).getByTestId('cluster-tile-button'))
      await waitFor(() => expect(screen.getByTestId('donut-total').textContent).toBe('240'))
      expect(tile('PVE-DR').dataset.selected).toBe('true')
      expect(getComputedStyle(tile('PVE-PROD')).opacity).toBe('0.55')
      expect(within(legendOf('zone:zweb')).getByTestId('legend-zone:zweb-members').textContent).toBe('1 guest')
      expect(screen.getByTestId('timeline-max').textContent).toBe('6')
      expect(screen.getAllByTestId('conversation-row').map(r => within(r).getByTestId('conversation-source').textContent)).toEqual(['web', '198.51.100.7'])
      // The Observation opens on that cluster.
      fireEvent.click(screen.getByTestId('conversations-all'))
      expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation', { cluster: 'conn-2' })

      // A second click shows the whole policy again; so does "All clusters".
      fireEvent.click(within(tile('PVE-DR')).getByTestId('cluster-tile-button'))
      await waitFor(() => expect(screen.getByTestId('donut-total').textContent).toBe('690'))
      fireEvent.click(within(tile('PVE-PROD')).getByTestId('cluster-tile-button'))
      await waitFor(() => expect(screen.getByTestId('donut-total').textContent).toBe('450'))
      expect(screen.getByTestId('timeline-max').textContent).toBe('4')
      fireEvent.click(within(screen.getByTestId('cluster-tile-all')).getByRole('button'))
      await waitFor(() => expect(screen.getByTestId('donut-total').textContent).toBe('690'))
      fireEvent.click(screen.getByTestId('conversations-all'))
      expect(onOpenMicroseg).toHaveBeenLastCalledWith('observation')

      // Not one request more: the filter keeps what was read.
      expect(vi.mocked(fetch).mock.calls.length).toBe(reads)
      expect(coverageUrls()).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the other clusters when one cannot be read, and says on its tile that its figures are missing', async () => {
    const now = new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString()
    postureReads({
      policy: SHARED, suggestions: [...OBSERVED, ...DR_OBSERVED], coverageBy: { 'conn-2': 'error' },
      trafficBy: { 'conn-1': { buckets: [{ at: now, zone: 'db', src_zone: 'web', verdict: 'would_block', hits: 4 }] }, 'conn-2': 'error' },
    })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS.slice(0, 2) })

    await waitFor(() => expect(tile('PVE-DR').dataset.missing).toBe('true'))
    expect(within(tile('PVE-DR')).getByTestId('cluster-tile-detail').textContent).toContain('Figures missing')
    expect(tile('PVE-PROD').dataset.missing).toBe('false')
    // The rest of the policy is drawn: its history, its flows.
    await waitFor(() => expect(screen.getByTestId('timeline-max').textContent).toBe('4'))
    expect(screen.getByTestId('donut-total').textContent).toBe('690')
  })

  it('names a cluster outside the user\'s scope in general words, never reads it, and leaves its traffic out in one line', async () => {
    const HIDDEN = seen({ src_ip: '10.7.0.9', hits: 900, connection_id: 'conn-2' })
    postureReads({ policy: SHARED, suggestions: [HIDDEN, ...OBSERVED.map(o => ({ ...o, connection_id: 'conn-1' }))] })
    renderDashboard({ enable: 1 }, { connections: [CONNECTIONS[0]] })

    await waitFor(() => expect(screen.getByTestId('donut-total').textContent).toBe('450'))
    expect(screen.getAllByTestId('cluster-tile').map(t => t.getAttribute('data-cluster'))).toEqual(['Another cluster', 'PVE-PROD'])
    expect(within(tile('Another cluster')).queryByTestId('cluster-tile-button')).toBeNull()
    expect(within(tile('Another cluster')).getByTestId('cluster-tile-detail').textContent).toBe('Outside your scope')
    expect(screen.getByTestId('cluster-strip-hidden').textContent).toBe('The traffic of 1 cluster outside your scope is not included.')
    expect(document.body.textContent).not.toContain('conn-2')
    expect(fetchedUrls().some(u => u.includes('conn-2'))).toBe(false)
  })

  it('says another cluster, never an ID, for a member of a cluster the user cannot see', async () => {
    postureReads({ policy: SHARED, suggestions: [seen({ src_ip: '10.7.0.4', hits: 500 }), ...OBSERVED], vmsBy: { 'conn-1': VMS } })
    renderDashboard({ enable: 1 }, { connections: [CONNECTIONS[0]] })

    await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(4))
    const first = screen.getAllByTestId('conversation-row')[0]
    expect(within(first).getByTestId('conversation-source').textContent).toBe('web')
    expect(within(first).getByTestId('conversation-peer-cluster').textContent).toBe('Another cluster')
    expect(document.body.textContent).not.toContain('conn-2')
    expect(fetchedUrls().some(u => u === '/api/v1/vms?connId=conn-2')).toBe(false)
    expect(fetchedUrls().filter(u => u === '/api/v1/vms?connId=conn-1')).toHaveLength(1)
  })

  it('shows one tile per cluster with its state, members and drifts, and opens the Drifts sub-tab from a count', async () => {
    postureReads({
      policy: SHARED, suggestions: OBSERVED, statusBy: { 'conn-2': { emergency_stop: true } },
      drifts: { drifts: [{ kind: 'unzoned_running', guest: { type: 'lxc', vmid: 300 } }], computed: true },
    })
    const onOpenMicroseg = vi.fn()
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS.slice(0, 2), connectionName: 'PVE-PROD', onOpenMicroseg })

    await waitFor(() => expect(screen.getAllByTestId('cluster-tile-detail').map(c => c.textContent)).toEqual([
      'Emergency stop · 33 members · 6 protected', 'Applied · 33 members · 6 protected',
    ]))
    expect(screen.getAllByTestId('cluster-tile').map(t => t.getAttribute('data-cluster'))).toEqual(['PVE-DR', 'PVE-PROD'])
    // No table and no caption any more.
    expect(screen.queryByTestId('dashboard-clusters')).toBeNull()
    expect(document.body.textContent).not.toContain('The figures below are those of')
    fireEvent.click(within(tile('PVE-DR')).getByTestId('cluster-tile-drifts'))
    expect(onOpenMicroseg).toHaveBeenCalledWith('drifts')
    // The drift count opens the Drifts sub-tab, it does not filter.
    expect(tile('PVE-DR').dataset.selected).toBe('false')
    const reads = microsegUrls().filter(u => /\/(status|drifts)$/.test(u)).sort()
    expect(reads).toEqual(['conn-1', 'conn-2'].flatMap(id => [`/api/v1/firewall/microseg/${id}/drifts`, `/api/v1/firewall/microseg/${id}/status`]))
  })

  it('names the zone and the cluster of a member of the other cluster on a flow its own cluster logged', async () => {
    postureReads({ policy: SHARED, suggestions: [FROM_DR, ...OBSERVED], vmsBy: { 'conn-2': DR_VMS } })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS.slice(0, 2) })

    await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(4))
    const first = screen.getAllByTestId('conversation-row')[0]
    expect(within(first).getByTestId('conversation-source').textContent).toBe('web')
    expect(within(first).getByTestId('conversation-peer-cluster').textContent).toBe('PVE-DR')
    // The flows of web on this cluster stay on their own row, with no chip.
    const local = screen.getAllByTestId('conversation-row')[1]
    expect(within(local).getByTestId('conversation-source').textContent).toBe('web')
    expect(within(local).queryByTestId('conversation-peer-cluster')).toBeNull()
  })

  it('does not wait more than 3 s for a slow cluster: the rows show, then name the cluster once its guests come', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let open: (v?: unknown) => void = () => undefined
      const gate = new Promise(resolve => { open = resolve })
      postureReads({ policy: SHARED, suggestions: [FROM_DR, ...OBSERVED], vmsBy: { 'conn-2': DR_VMS }, vmsGate: { 'conn-2': gate } })
      renderDashboard({ enable: 1 }, { connections: CONNECTIONS.slice(0, 2) })

      await screen.findByTestId('traffic-legend')
      expect(screen.getByTestId('conversations-loading')).toBeInTheDocument()
      await act(async () => { vi.advanceTimersByTime(3100) })
      // Shown without the other cluster: web-dr's flows are with web's.
      await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(3))
      expect(screen.queryByTestId('conversation-peer-cluster')).toBeNull()

      await act(async () => { open() })
      await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(4))
      expect(within(screen.getAllByTestId('conversation-row')[0]).getByTestId('conversation-peer-cluster').textContent).toBe('PVE-DR')
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks for the observed flows of one cluster without waiting for the policy', async () => {
    postureReads({ policy: 'pending' })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS })

    await waitFor(() => expect(microsegUrls()).toContain('/api/v1/firewall/microseg/conn-1/suggestions?status=pending&limit=200'))
  })

  it('issues exactly the reads of a policy that is not shared', async () => {
    postureReads({ policy: { ...POLICY, clusters: [link('conn-1')] }, vmsBy: { 'conn-2': DR_VMS } })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS })
    await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(3))

    expect(microsegUrls().filter(u => !u.includes('/events?') && !u.includes('/traffic?'))).toEqual([
      '/api/v1/firewall/microseg/conn-1/policy',
      '/api/v1/firewall/microseg/conn-1/suggestions?status=pending&limit=200',
    ])
    expect(fetchedUrls().some(u => u.startsWith('/api/v1/vms?'))).toBe(false)
    expect(screen.queryByTestId('conversation-peer-cluster')).toBeNull()
  })

  it('keeps a policy of one cluster as it was: no strip, the same blocks, exactly the same requests', async () => {
    postureReads({ policy: { ...POLICY, clusters: [link('conn-1')] }, traffic: { buckets: [] } })
    renderDashboard({ enable: 1 }, { connections: CONNECTIONS, connectionName: 'PVE-PROD' })
    await waitFor(() => expect(screen.getAllByTestId('conversation-row')).toHaveLength(3))
    await waitFor(() => expect(fetchedUrls().some(u => u.includes('/traffic?'))).toBe(true))

    expect(screen.queryByTestId('cluster-strip')).toBeNull()
    expect(screen.queryByTestId('dashboard-clusters')).toBeNull()
    const blocks = [...screen.getByTestId('dashboard').querySelectorAll('[data-testid$="-card"]')].map(b => b.getAttribute('data-testid'))
    expect(blocks).toEqual(['traffic-card', 'distribution-card', 'services-card', 'conversations-card'])
    const shown = fetchedUrls().map(u => (u.includes('/traffic?') ? u.slice(0, u.indexOf('?')) : u)).sort()
    expect(shown).toEqual([
      '/api/v1/firewall/coverage/conn-1',
      '/api/v1/firewall/microseg/conn-1/policy',
      '/api/v1/firewall/microseg/conn-1/suggestions?status=pending&limit=200',
      '/api/v1/firewall/microseg/conn-1/traffic',
      '/api/v1/orchestrator/sflow?endpoint=ip-pairs&n=500',
    ])
  })
})

describe('DashboardTab: no To do list, the whole height', () => {
  it('has no To do list and reads no drifts', async () => {
    stubReads({ drifts: { drifts: UNZONED_13 }, suggestions: [seen({})] })
    renderDashboard({ enable: 1, policy_in: 'ACCEPT' })
    await screen.findByTestId('traffic-legend')

    expect(document.querySelector('[data-testid^="todo-"]')).toBeNull()
    expect(screen.queryByText('Nothing to do')).not.toBeInTheDocument()
    expect(fetchedUrls().some(u => u.includes('/drifts'))).toBe(false)
  })

  it('stretches down to the bottom of the page: the conversations take the free height, the traffic chart that of its row, never under 160 px', async () => {
    postureReads()
    renderDashboard({ enable: 1 })
    await screen.findByTestId('traffic-legend')

    expect(getComputedStyle(screen.getByTestId('dashboard')).flexGrow).toBe('1')
    expect(getComputedStyle(screen.getByTestId('conversations-card').parentElement as Element).flexGrow).toBe('1')
    expect(getComputedStyle(screen.getByTestId('traffic-card')).flexGrow).toBe('1')
    const chart = screen.getByTestId('timeline-chart')
    expect(getComputedStyle(chart).flexGrow).toBe('1')
    expect(getComputedStyle(chart).minHeight).toBe('160px')
  })

})

describe('DashboardTab: load error', () => {
  it('keeps the load warning at the top', async () => {
    stubReads()
    const reload = vi.fn()
    renderDashboard(null, { loadError: 'HTTP 502', reload })

    expect(screen.getByText(/Some firewall data could not be loaded.*HTTP 502/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('says the observed traffic is not available when the micro-segmentation cannot be read', async () => {
    stubReads({ suggestions: 'error' })
    renderDashboard({ enable: 1 })

    expect(await screen.findByTestId('traffic-unavailable')).toBeInTheDocument()
  })
})
