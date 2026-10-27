import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  hasFeature: vi.fn(),
  checkPermission: vi.fn(),
  rbacScope: vi.fn(),
  infra: vi.fn(),
  connections: vi.fn(),
  orchestrator: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (id: string) => m.hasFeature(id) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', ALERTS_MANAGE: 'alerts.manage', ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  getCurrentRbacInfraScope: (...a: unknown[]) => m.rbacScope(...a),
}))
vi.mock('@/lib/tenant/infraScope', async orig => ({
  ...(await orig<typeof import('@/lib/tenant/infraScope')>()),
  getTenantInfrastructureScope: (...a: unknown[]) => m.infra(...a),
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: (...a: unknown[]) => m.connections(...a) } } }))
vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: unknown[]) => m.orchestrator(...a),
}))

import { GET } from './route'

const NAMES: Record<string, string> = { c1: 'Lyon prod', c2: 'Paris DR' }

function result(connection_id: string, kind: 'node' | 'cluster', node: string | undefined, up: number, down: number, unobserved = 0) {
  return {
    ref: { connection_id, kind, ...(node ? { node } : {}) },
    up_seconds: up, down_seconds: down, maintenance_seconds: 0, unobserved_seconds: unobserved,
    availability: up + down ? (up / (up + down)) * 100 : null, coverage: 100, slots: [{ start: 'x', state: 'up' }], incidents: [],
  }
}

const RESULTS = [
  result('c1', 'cluster', undefined, 86400, 0),
  result('c1', 'node', 'pve1', 86400, 0),
  result('c1', 'node', 'pve2', 80000, 6400),
  result('c2', 'cluster', undefined, 86400, 0),
  result('c2', 'node', 'pve3', 43200, 0, 43200),
]
const STATES = [
  { ref: { connection_id: 'c1', kind: 'cluster' }, state: 'up' },
  { ref: { connection_id: 'c1', kind: 'node', node: 'pve1' }, state: 'up' },
  { ref: { connection_id: 'c1', kind: 'node', node: 'pve2' }, state: 'maintenance' },
  { ref: { connection_id: 'c1', kind: 'guest', vmid: 100 }, state: 'down' },
  { ref: { connection_id: 'c2', kind: 'cluster' }, state: 'down' },
  { ref: { connection_id: 'c2', kind: 'node', node: 'pve3' }, state: 'up' },
]

let lastQuery: any
let lastCurrent: any

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u1', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
  m.rbacScope.mockResolvedValue(null)
  m.infra.mockResolvedValue({ kind: 'provider' })
  m.connections.mockImplementation(async ({ where, select }: any) => {
    const ids = ['c1', 'c2'].filter(id => !where.id || where.id.in.includes(id))
    return ids.map(id => (select.name ? { id, name: NAMES[id] } : { id }))
  })
  m.orchestrator.mockImplementation(async (path: string, opts: any) => {
    if (path === '/availability/query') {
      lastQuery = opts.body
      return { from: opts.body.from, to: opts.body.to, results: RESULTS, summary: { coverage: 87.5 }, policy: null }
    }
    lastCurrent = opts.body
    return { collected_at: { c1: '2026-10-27T10:00:00Z' }, states: STATES, covered_guests_down: 3 }
  })
})

async function overview(period?: string) {
  return callRoute(GET as any, period ? { searchParams: { period } } : {})
}

describe('GET /availability/overview', () => {
  it('24h by default: 200, nodes and clusters, the covered guests tile', async () => {
    const res = await overview()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.period).toBe('24h')
    expect(body.connections.map((c: any) => [c.id, c.name, c.cluster?.ref.kind ?? null, c.nodes.length])).toEqual([
      ['c1', 'Lyon prod', 'cluster', 2],
      ['c2', 'Paris DR', 'cluster', 1],
    ])
    const { coverage, ...counts } = body.tiles
    expect(counts).toEqual({ nodesUp: 2, nodesTotal: 3, clustersQuorate: 1, clustersTotal: 2, nodesMaintenance: 1, coveredGuestsDown: 3 })
    // Nodes of every visible connection, not the orchestrator's global summary (87.5, clusters included).
    expect(coverage).toBeCloseTo((216000 / 259200) * 100, 10)
    expect(lastCurrent).toEqual({ connection_ids: ['c1', 'c2'], tenant_id: 'default', scope: null, include_covered: true })
    expect(lastQuery).toMatchObject({ connection_ids: ['c1', 'c2'], tenant_id: 'default', scope: null, slot_seconds: 60 })
    expect(Date.parse(lastQuery.to) - Date.parse(lastQuery.from)).toBe(24 * 3600 * 1000)
  })

  it('computes the per-connection summary over its nodes', async () => {
    const body = await (await overview()).json()
    const c1 = body.connections.find((c: any) => c.id === 'c1')
    expect(c1.summary.up_seconds).toBe(166400)
    expect(c1.summary.availability).toBeCloseTo((166400 / 172800) * 100, 10)
    const c2 = body.connections.find((c: any) => c.id === 'c2')
    expect(c2.summary.coverage).toBe(50)
  })

  it('sends only node and cluster states, never a guest', async () => {
    const body = await (await overview()).json()
    expect(body.current.states.some((s: any) => s.ref.kind === 'guest')).toBe(false)
    expect(body.current.collectedAt).toEqual({ c1: '2026-10-27T10:00:00Z' })
  })

  it('returns 403 for every period without sla_monitoring, before any call', async () => {
    m.hasFeature.mockResolvedValue(false)
    for (const period of [undefined, '1h', '24h', '7d', '30d']) {
      const res = await overview(period)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'feature_required', feature: 'sla_monitoring' })
    }
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('7d with sla_monitoring: slot of 10 min and the covered guests tile', async () => {
    const res = await overview('7d')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(lastQuery.slot_seconds).toBe(600)
    expect(lastCurrent.include_covered).toBe(true)
    expect(body.tiles.coveredGuestsDown).toBe(3)
  })

  it('400 for an unknown period, its case or spacing changed', async () => {
    for (const period of ['90d', '24H', ' 24h']) {
      const res = await overview(period)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_period' })
    }
    const encoded = await callRoute(GET as any, { url: 'http://test.local/_?period=%2024h' })
    expect(encoded.status).toBe(400)
  })

  it('a repeated period is judged on the first one', async () => {
    const res = await callRoute(GET as any, { url: 'http://test.local/_?period=30d&period=24h' })
    expect(res.status).toBe(200)
    expect((await res.json()).period).toBe('30d')
  })

  it('503 and no figure when the orchestrator is out of reach', async () => {
    m.orchestrator.mockRejectedValue(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    const res = await overview()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'orchestrator_unavailable' })
  })

  it('an iaas tenant sees neither the cluster row nor another connection', async () => {
    m.tenant.mockResolvedValue('acme')
    m.session.mockResolvedValue({ user: { id: 'u2', email: 'acme@x', tenantId: 'acme' } })
    m.infra.mockResolvedValue({ kind: 'iaas', vdcScope: {
      connectionIds: new Set(['c1']), nodesByConnection: new Map([['c1', new Set(['pve1'])]]), poolsByConnection: new Map([['c1', new Set(['acme'])]]),
    } })
    const res = await overview()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(lastQuery.scope).toEqual({ connections: { c1: { all: false, nodes: ['pve1'], pools: ['acme'] } } })
    expect(lastQuery.connection_ids).toEqual(['c1'])
    expect(lastQuery.tenant_id).toBe('acme')
    // The orchestrator mock answers everything: the route still drops what is out of scope.
    expect(body.connections).toHaveLength(1)
    expect(body.connections[0].cluster).toBeNull()
    expect(body.connections[0].nodes.map((n: any) => n.ref.node)).toEqual(['pve1'])
    expect(body.current.states.map((s: any) => s.ref.node ?? s.ref.kind)).toEqual(['pve1'])
    expect(body.tiles).toMatchObject({ clustersTotal: 0, nodesTotal: 1, coverage: 100 })
    expect(JSON.stringify(body)).not.toContain('Paris DR')
    expect(JSON.stringify(body)).not.toContain('pve2')
    // Names are read for the connections of the perimeter only.
    const nameCall = m.connections.mock.calls.find(([a]: any) => a.select.name)
    expect(nameCall[0].where).toEqual({ id: { in: ['c1'] } })
  })

  it('no visible connection: an empty overview without calling the orchestrator', async () => {
    m.tenant.mockResolvedValue('acme')
    m.infra.mockResolvedValue({ kind: 'msp', connectionIds: new Set() })
    const body = await (await overview()).json()
    expect(body.connections).toEqual([])
    expect(body.tiles).toMatchObject({ nodesTotal: 0, coverage: null })
    expect(m.orchestrator).not.toHaveBeenCalled()
  })

  it('401 without a session, 403 without connection.view', async () => {
    m.session.mockResolvedValue(null)
    expect((await overview()).status).toBe(401)
    m.session.mockResolvedValue({ user: { id: 'u1', tenantId: 'default' } })
    m.checkPermission.mockResolvedValue(NextResponse.json({ error: 'Permission denied' }, { status: 403 }))
    expect((await overview()).status).toBe(403)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })
})
