// src/lib/demo/availabilityDemo.ts
//
// Demo mode answers of the availability and SLA routes: pure functions of the
// requested period and of `now`, the exact shapes of the real routes
// (src/app/api/v1/availability, src/app/api/v1/sla). One connection of three
// nodes, one 47 minute incident, one 2 h maintenance, two policies and one
// upcoming maintenance window. The events sit at fixed distances before `now`,
// so every period shows the same story as far as it reaches back.

import { parsePeriod, parseWindow, periodBounds, windowBounds, type Period, type PeriodWindow } from '@/lib/availability/period'
import { summarize } from '@/lib/availability/summary'
import type {
  AvailabilityState,
  Budget,
  CurrentState,
  Incident,
  ObjectRef,
  Result,
  Slot,
  Summary,
} from '@/lib/availability/types'

export const DEMO_AVAILABILITY_CONNECTION_ID = 'demo-pve-cluster-001'
const CONNECTION_NAME = 'Production Cluster'
const NODES = ['pve-node-01', 'pve-node-02', 'pve-node-03']
const PAGE_SIZE = 20
const DEFAULT_TARGET = 99.9
const RETENTION_DAYS = 400
const CREATED_BY = 'demo@proxcenter.io'

const MIN = 60_000
const HOUR = 3_600_000

interface Event {
  state: AvailabilityState
  /** Distance before now of the end of the event, and its length. */
  endsAgoMs: number
  lengthMs: number
}

const NODE_EVENTS: Record<string, Event[]> = {
  'pve-node-01': [],
  'pve-node-02': [{ state: 'down', endsAgoMs: 5 * HOUR, lengthMs: 47 * MIN }],
  'pve-node-03': [{ state: 'maintenance', endsAgoMs: 14 * HOUR, lengthMs: 2 * HOUR }],
}

interface DemoGuest {
  vmid: number
  name: string
  type: 'qemu' | 'lxc'
  events: Event[]
}

interface DemoPolicy {
  id: string
  name: string
  target: number
  guests: DemoGuest[]
}

const POLICIES: DemoPolicy[] = [
  {
    id: 'demo-sla-erp',
    name: 'ERP',
    target: 99.95,
    guests: [
      { vmid: 201, name: 'erp-app', type: 'qemu', events: [{ state: 'down', endsAgoMs: 3 * HOUR, lengthMs: 25 * MIN }] },
      { vmid: 202, name: 'erp-db', type: 'qemu', events: [] },
    ],
  },
  {
    id: 'demo-sla-web',
    name: 'Production web',
    target: 99.9,
    guests: [
      { vmid: 101, name: 'web-01', type: 'qemu', events: [] },
      { vmid: 102, name: 'web-02', type: 'lxc', events: [] },
    ],
  },
]

const overlapMs = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/** One object over the window: its slots, its seconds and its incidents. */
function buildResult(ref: ObjectRef, events: Event[], now: number, fromMs: number, toMs: number, slotSeconds: number): Result {
  const abs = events.map(e => ({ state: e.state, from: now - e.endsAgoMs - e.lengthMs, to: now - e.endsAgoMs }))
  const slotMs = slotSeconds * 1000
  const slots: Slot[] = []
  for (let t = fromMs; t < toMs; t += slotMs) {
    const hit = (state: AvailabilityState) => abs.some(e => e.state === state && overlapMs(e.from, e.to, t, t + slotMs) > 0)
    slots.push({ start: new Date(t).toISOString(), state: (['down', 'maintenance'] as const).find(hit) ?? 'up' })
  }

  const seconds = (state: AvailabilityState) =>
    abs.filter(e => e.state === state).reduce((sum, e) => sum + overlapMs(e.from, e.to, fromMs, toMs), 0) / 1000
  const down = seconds('down')
  const maintenance = seconds('maintenance')
  const up = (toMs - fromMs) / 1000 - down - maintenance
  const incidents: Incident[] = abs
    .filter(e => e.state === 'down' && overlapMs(e.from, e.to, fromMs, toMs) > 0)
    .map(e => ({ from: new Date(Math.max(e.from, fromMs)).toISOString(), to: new Date(Math.min(e.to, toMs)).toISOString(), state: 'down' }))

  return {
    ref,
    up_seconds: up,
    down_seconds: down,
    maintenance_seconds: maintenance,
    unobserved_seconds: 0,
    availability: up + down === 0 ? null : (up / (up + down)) * 100,
    coverage: up + down === 0 ? null : 100,
    slots,
    incidents,
  }
}

function window(period: PeriodWindow, now: Date) {
  const { from, to, slotSeconds } = windowBounds(period, now) ?? periodBounds('24h', now)
  // Events hang off the minute, so a 47 minute incident is 47 one minute slots.
  return { from, to, slotSeconds, nowMs: Math.floor(now.getTime() / MIN) * MIN }
}

export function demoOverview(period: PeriodWindow, now: Date) {
  const w = window(period, now)
  const fromMs = Date.parse(w.from)
  const toMs = Date.parse(w.to)
  const build = (ref: ObjectRef, events: Event[]) => buildResult(ref, events, w.nowMs, fromMs, toMs, w.slotSeconds)

  const cluster = build({ connection_id: DEMO_AVAILABILITY_CONNECTION_ID, kind: 'cluster' }, [])
  const nodes = NODES.map(node => build({ connection_id: DEMO_AVAILABILITY_CONNECTION_ID, kind: 'node', node }, NODE_EVENTS[node]))
  const states: CurrentState[] = [cluster, ...nodes].map(r => ({ ref: r.ref, state: 'up' }))
  const summary = summarize(nodes)

  return {
    period: typeof period === 'string' ? period : 'custom',
    from: w.from,
    to: w.to,
    connections: [{ id: DEMO_AVAILABILITY_CONNECTION_ID, name: CONNECTION_NAME, cluster, nodes, summary }],
    unmeasured: 0,
    canConfigure: true,
    current: { states, collectedAt: { [DEMO_AVAILABILITY_CONNECTION_ID]: new Date(w.nowMs).toISOString() } },
    tiles: {
      nodesUp: nodes.length,
      nodesTotal: nodes.length,
      clustersQuorate: 1,
      clustersTotal: 1,
      nodesMaintenance: 0,
      coveredGuestsDown: 0,
      coverage: summary.coverage,
    },
  }
}

/** The summary of a policy: the guests' totals, the objects under target and the error budget. */
function policySummary(policy: DemoPolicy, results: Result[]): Summary {
  const base = summarize(results)
  const measured = base.up_seconds + base.down_seconds
  const allowed = (measured * (100 - policy.target)) / 100
  const budget: Budget = { allowed_seconds: allowed, used_seconds: base.down_seconds, remaining_seconds: allowed - base.down_seconds }
  return {
    ...base,
    below_target: results.filter(r => r.availability !== null && r.availability < policy.target).length,
    budget,
  }
}

function policyResults(policy: DemoPolicy, period: Period, now: Date): Result[] {
  const w = window(period, now)
  return policy.guests.map(g => buildResult(
    { connection_id: DEMO_AVAILABILITY_CONNECTION_ID, kind: 'guest', vmid: g.vmid },
    g.events, w.nowMs, Date.parse(w.from), Date.parse(w.to), w.slotSeconds))
}

function policyView(policy: DemoPolicy, now: Date) {
  const created = new Date(now.getTime() - 40 * 24 * HOUR).toISOString()
  return {
    id: policy.id,
    name: policy.name,
    target: policy.target,
    guests: policy.guests.map(g => ({ connectionId: DEMO_AVAILABILITY_CONNECTION_ID, vmid: g.vmid })),
    tags: [] as string[],
    pools: [] as string[],
    enabled: true,
    createdBy: CREATED_BY,
    createdAt: created,
    updatedAt: created,
  }
}

export function demoPolicies(period: Period, page: number, now: Date) {
  const { from, to } = periodBounds(period, now)
  const rows = POLICIES.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  return {
    data: rows.map(p => {
      const results = policyResults(p, period, now)
      return { ...policyView(p, now), summary: policySummary(p, results), guestCount: results.length }
    }),
    total: POLICIES.length,
    page,
    pageSize: PAGE_SIZE,
    period,
    from,
    to,
    defaultTarget: DEFAULT_TARGET,
  }
}

export function demoPolicyNames() {
  return { items: POLICIES.map(p => ({ id: p.id, name: p.name, enabled: true })) }
}

/** null for an unknown policy. */
export function demoPolicyDetail(id: string, period: Period, now: Date) {
  const policy = POLICIES.find(p => p.id === id)
  if (!policy) return null
  const { from, to } = periodBounds(period, now)
  const results = policyResults(policy, period, now)
  return {
    policy: policyView(policy, now),
    period,
    from,
    to,
    results: results.map((r, i) => ({ ...r, name: policy.guests[i].name, type: policy.guests[i].type })),
    connectionNames: { [DEMO_AVAILABILITY_CONNECTION_ID]: CONNECTION_NAME },
    summary: policySummary(policy, results),
  }
}

export function demoMaintenanceWindows(now: Date) {
  const starts = new Date(Math.ceil((now.getTime() + 2 * 24 * HOUR) / HOUR) * HOUR)
  return {
    data: [{
      id: 'demo-window-1',
      scope: 'node',
      connectionId: DEMO_AVAILABILITY_CONNECTION_ID,
      node: 'pve-node-02',
      vmid: null,
      policyId: null,
      startsAt: starts.toISOString(),
      endsAt: new Date(starts.getTime() + 2 * HOUR).toISOString(),
      reason: 'Kernel update',
      createdBy: CREATED_BY,
      createdAt: new Date(now.getTime() - HOUR).toISOString(),
    }],
    total: 1,
    page: 1,
    pageSize: PAGE_SIZE,
  }
}

export function demoSettings(sent?: unknown) {
  const body = (typeof sent === 'object' && sent !== null ? sent : {}) as Record<string, unknown>
  return {
    retentionDays: Number.isFinite(body.retentionDays) ? (body.retentionDays as number) : RETENTION_DAYS,
    defaultTarget: Number.isFinite(body.defaultTarget) ? (body.defaultTarget as number) : DEFAULT_TARGET,
    measuredConnections: Array.isArray(body.measuredConnections) ? body.measuredConnections : [DEMO_AVAILABILITY_CONNECTION_ID],
    policiesByConnection: {},
  }
}

/**
 * The body a demo GET of an availability route answers, undefined for any
 * other path. The two error bodies carry the codes of the real routes.
 */
export function demoAvailabilityResponse(url: URL, now: Date): unknown {
  const path = url.pathname
  const params = url.searchParams

  if (path === '/api/v1/availability/settings') return demoSettings()
  if (path === '/api/v1/availability/measured') return { connectionIds: [DEMO_AVAILABILITY_CONNECTION_ID] }
  if (path === '/api/v1/sla/maintenance-windows') return demoMaintenanceWindows(now)

  if (path === '/api/v1/availability/overview') {
    const requested = parseWindow(params, '24h')
    return requested === null || windowBounds(requested, now) === null ? { error: 'invalid_period' } : demoOverview(requested, now)
  }

  if (path === '/api/v1/sla/policies') {
    if (params.get('fields') === 'names') return demoPolicyNames()
    const period = parsePeriod(params.get('period'), '30d')
    if (period === null) return { error: 'invalid_period' }
    const page = Number.parseInt(params.get('page') ?? '1', 10)
    return demoPolicies(period, Number.isInteger(page) && page >= 1 ? page : 1, now)
  }

  const detail = /^\/api\/v1\/sla\/policies\/([^/]+)$/.exec(path)
  if (detail) {
    const period = parsePeriod(params.get('period'), '30d')
    if (period === null) return { error: 'invalid_period' }
    let id: string
    try {
      id = decodeURIComponent(detail[1])
    } catch {
      return { error: 'not_found' }
    }
    return demoPolicyDetail(id, period, now) ?? { error: 'not_found' }
  }

  return undefined
}
