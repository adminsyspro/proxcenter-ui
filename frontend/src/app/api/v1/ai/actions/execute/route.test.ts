/**
 * Execute route of the assistant's approved actions (roadmap#188).
 *
 * The real existing route handlers run (dispatch is in process): only Proxmox
 * (`pveFetch` and the connection lookup), the orchestrator client, SSH, RBAC
 * (`checkPermission`), the session principal, the licence and the caller's
 * RBAC snapshot are mocked at their module boundary. Audit rows and settings
 * go to the real test database, so the JSON queries behind replay, cap and
 * plan order run for real.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InventorySnapshot, SnapshotGuest, SnapshotNode } from '@/lib/tools/snapshot'

const h = vi.hoisted(() => ({
  pveFetch: vi.fn<(conn: unknown, path: string, init?: { method?: string; body?: string }) => Promise<unknown>>(),
  executeSSH: vi.fn<(...args: unknown[]) => Promise<{ success: boolean; output?: string; error?: string }>>(),
  denied: new Set<string>(),
  features: new Set<string>(['ai_insights', 'ai_actions']),
  principal: { kind: 'session', userId: 'u1', userEmail: 'u1@test.local', tenantId: 'default', connectionIds: null } as Record<string, unknown> | null,
  snapshot: null as InventorySnapshot | null,
  snapshotError: null as Error | null,
  invalidateInventoryCache: vi.fn<(tenantId?: string) => void>(),
  client: {
    getRecommendations: vi.fn<(...args: unknown[]) => Promise<{ data: unknown[] }>>(),
    executeRecommendation: vi.fn<(id: string) => Promise<{ data: unknown }>>(),
    getActiveMigrations: vi.fn<() => Promise<{ data: unknown[] }>>(),
    get: vi.fn<(path: string) => Promise<{ data: unknown }>>(),
  },
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (conn: unknown, path: string, init?: { method?: string; body?: string }) => h.pveFetch(conn, path, init) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
  getConnectionByIdOrNull: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
  isConnectionNotFoundError: () => false,
}))
vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => h.client,
  orchestratorFetch: vi.fn(),
  orchestratorPath: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((o, p, i) => o + p + (i < v.length ? String(v[i]) : ''), ''),
}))
vi.mock('@/lib/ssh/exec', () => ({ executeSSH: (...args: unknown[]) => h.executeSSH(...args) }))
vi.mock('@/lib/ssh/node-endpoint', async io => ({
  ...(await io<typeof import('@/lib/ssh/node-endpoint')>()),
  resolveNodeSshEndpoint: async () => ({ host: '10.0.0.1', port: 22, source: 'proxmox' }),
}))
vi.mock('@/lib/rbac', async io => {
  const { NextResponse } = await import('next/server')

  return {
    ...(await io<typeof import('@/lib/rbac')>()),
    checkPermission: async (permission: string, _type?: string, id?: string) =>
      h.denied.has(`${permission}|${id ?? '*'}`) ? NextResponse.json({ error: `Forbidden: missing ${permission}` }, { status: 403 }) : null,
  }
})
vi.mock('@/lib/auth/principal', async io => ({
  ...(await io<typeof import('@/lib/auth/principal')>()),
  getPrincipal: async () => ({ ok: true, principal: h.principal ?? undefined }),
  getTokenPrincipalContext: async () => ({ principal: null, rejected: false }),
}))
vi.mock('@/lib/auth/requireEnterprise', async io => {
  const { NextResponse } = await import('next/server')

  return {
    ...(await io<typeof import('@/lib/auth/requireEnterprise')>()),
    requireFeature: async (f: string) => (h.features.has(f) ? null : NextResponse.json({ error: 'Feature not licensed' }, { status: 403 })),
  }
})
vi.mock('@/lib/tenant', async io => ({
  ...(await io<typeof import('@/lib/tenant')>()),
  getCurrentTenantId: async () => 'default',
  getTenantConnectionIds: async () => new Set(['c1']),
}))
vi.mock('@/lib/tools/snapshot', async io => ({
  ...(await io<typeof import('@/lib/tools/snapshot')>()),
  collectInventorySnapshot: async () => {
    if (h.snapshotError) throw h.snapshotError

    return h.snapshot
  },
}))
vi.mock('@/lib/cache/inventoryCache', async io => ({
  ...(await io<typeof import('@/lib/cache/inventoryCache')>()),
  invalidateInventoryCache: (tenantId?: string) => h.invalidateInventoryCache(tenantId),
}))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { clearStorageConfigCache } from '@/lib/ai/actions/preflight'
import { saveAiActionsSettings } from '@/lib/ai/actions/settings'
import { ACTION_CARD_TTL_MS, signCard } from '@/lib/ai/actions/token'
import { ACTION_KINDS, ACTION_TIER, type ActionCard, type ActionKind } from '@/lib/ai/actions/types'
import { clearBackupJobsCache } from '@/lib/tools/backups'

import { POST } from './route'

const CONV = 'conv-1'
const bind = { userId: 'u1', tenantId: 'default', conversationId: CONV }

const node = (name: string, over: Partial<SnapshotNode> = {}): SnapshotNode => ({
  connId: 'c1', cluster: 'PVE-PROD', name, status: 'online', cpuPct: 5, cores: 32, memPct: 20, memUsedGb: 12, memTotalGb: 64, ...over,
})

const guest = (vmid: string, name: string, kind: 'qemu' | 'lxc', status: string, nodeName: string, over: Partial<SnapshotGuest> = {}): SnapshotGuest => ({
  connId: 'c1', cluster: 'PVE-PROD', vmid, name, type: kind === 'lxc' ? 'CT' : 'VM', kind, status, node: nodeName,
  cpuPct: 1, vcpus: 2, memPct: 50, memUsedGb: 4, memTotalGb: 8, template: false, ...over,
})

function snapshot(guests?: SnapshotGuest[], nodes?: SnapshotNode[]): InventorySnapshot {
  const g = guests ?? [
    guest('104', 'win2025', 'qemu', 'running', 'pve1'),
    guest('205', 'ct-web', 'lxc', 'running', 'pve1'),
    guest('101', 'db-01', 'qemu', 'stopped', 'pve2'),
  ]

  return {
    clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: 3, guestCount: g.length }],
    nodes: nodes ?? [node('pve1'), node('pve2'), node('pve3')],
    guests: g,
    summary: { totalGuests: g.length, runningGuests: 2, stoppedGuests: 1, totalNodes: 3, onlineNodes: 3 },
    cached: false,
    restricted: false,
  }
}

const WIN = { connId: 'c1', cluster: 'PVE-PROD', node: 'pve1', vmid: 104, guestKind: 'qemu' as const, name: 'win2025' }
const CT = { connId: 'c1', cluster: 'PVE-PROD', node: 'pve1', vmid: 205, guestKind: 'lxc' as const, name: 'ct-web' }
const HOST2 = { connId: 'c1', cluster: 'PVE-PROD', node: 'pve2', name: 'pve2' }

let seq = 0

function card(kind: ActionKind, target: ActionCard['target'], params: ActionCard['params'] = {}, over: Partial<ActionCard> = {}, b = bind): ActionCard {
  seq++

  return signCard(
    {
      actionId: `act-${seq}`,
      kind,
      tier: ACTION_TIER[kind],
      target,
      params,
      preflight: { ok: true, checks: [] },
      expiresAt: Date.now() + ACTION_CARD_TTL_MS,
      ...over,
    },
    b
  )
}

const snapCard = (over: Partial<ActionCard> = {}) => card('snapshot', WIN, { name: 'ai-20261031-1200' }, over)

async function execute(body: unknown) {
  const res = await callRoute(POST, { body: body as Record<string, unknown>, url: 'http://test.local/api/v1/ai/actions/execute' })

  return { status: res.status, body: (await readJson(res)) as Record<string, any> }
}

const run = (c: ActionCard, over: Record<string, unknown> = {}) => execute({ card: c, conversationId: CONV, ...over })

async function rows(action?: string) {
  return prismaTest.auditLog.findMany({ where: action ? { action } : {}, orderBy: { timestamp: 'asc' } })
}

const pveCalls = (method: string, suffix: string) =>
  h.pveFetch.mock.calls.filter(([, path, init]) => (init?.method ?? 'GET') === method && String(path).endsWith(suffix))

const PRECONDITION = { allowed_nodes: ['pve2', 'pve3'], local_disks: [], local_resources: [], 'mapped-resources': [], not_allowed_nodes: {}, running: 1 }

async function enable(over: Record<string, unknown> = {}) {
  await saveAiActionsSettings('default', {
    enabled: true,
    actions: Object.fromEntries(ACTION_KINDS.map(k => [k, true])),
    ...over,
  })
}

beforeAll(() => {
  process.env.APP_SECRET = 'execute-test-secret'
})
afterAll(() => {
  delete process.env.APP_SECRET
})

beforeEach(async () => {
  await truncate(['audit_logs', 'settings'])
  await enable()
  clearBackupJobsCache()
  clearStorageConfigCache()
  h.denied.clear()
  h.features = new Set(['ai_insights', 'ai_actions'])
  h.principal = { kind: 'session', userId: 'u1', userEmail: 'u1@test.local', tenantId: 'default', connectionIds: null }
  h.snapshot = snapshot()
  h.snapshotError = null
  h.invalidateInventoryCache.mockReset()
  h.executeSSH.mockReset().mockResolvedValue({ success: true, output: '' })
  h.client.getRecommendations.mockReset().mockResolvedValue({ data: [] })
  h.client.executeRecommendation.mockReset().mockResolvedValue({ data: { status: 'executing' } })
  h.client.getActiveMigrations.mockReset().mockResolvedValue({ data: [] })
  h.client.get.mockReset().mockResolvedValue({ data: { max_concurrent_migrations: 2 } })
  h.pveFetch.mockReset().mockImplementation(async (_conn, path, init) => {
    const method = init?.method ?? 'GET'

    if (method === 'POST' && /\/snapshot$/.test(path)) return 'UPID:pve1:00001:snapshot'
    if (method === 'POST' && /\/status\/\w+$/.test(path)) return `UPID:pve1:00002:${path.split('/').pop()}`
    if (method === 'POST' && /\/migrate$/.test(path)) return 'UPID:pve1:00003:migrate'
    if (method === 'GET' && /\/qemu\/\d+\/migrate$/.test(path)) return PRECONDITION
    if (method === 'GET' && path === '/cluster/resources?type=vm') return [{ vmid: 205, node: 'pve1', name: 'ct-web' }]
    if (method === 'GET' && path === '/cluster/backup') return [{ id: 'nightly', vmid: '104' }]
    if (method === 'GET' && path === '/cluster/backup/nightly') return { id: 'nightly', vmid: '104' }
    if (method === 'PUT' && path === '/cluster/backup/nightly') return null
    if (method === 'GET') return []
    throw new Error(`unexpected ${method} ${path}`)
  })
})

describe('POST /api/v1/ai/actions/execute', () => {
  it('runs a snapshot through the existing route, tags its audit row and writes the ai.action row', async () => {
    const c = snapCard()
    const res = await run(c)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      result: { upid: 'UPID:pve1:00001:snapshot', node: 'pve1', connId: 'c1', message: "Snapshot 'ai-20261031-1200' creation started" },
    })
    expect(pveCalls('POST', '/nodes/pve1/qemu/104/snapshot')).toHaveLength(1)

    const [own] = await rows('snapshot')

    expect(own.userId).toBe('u1')
    expect(own.details).toMatchObject({ node: 'pve1', snapshotName: 'ai-20261031-1200', via: 'assistant', conversationId: CONV, actionId: c.actionId })

    const [ai] = await rows('ai.action')

    expect(ai).toMatchObject({ category: 'vms', status: 'success', resourceType: 'qemu', resourceId: '104', resourceName: 'win2025', userId: 'u1' })
    expect(ai.details).toMatchObject({
      via: 'assistant', conversationId: CONV, actionId: c.actionId, kind: 'snapshot', outcome: 'dispatched', httpStatus: 200,
      target: 'snapshot win2025 (104) on pve1 as "ai-20261031-1200"',
    })
  })

  // Review Focus 3
  it('refuses the same card a second time: 409 already-executed, Proxmox called once', async () => {
    const c = snapCard()

    expect((await run(c)).status).toBe(200)
    const again = await run(c)

    expect(again.status).toBe(409)
    expect(again.body).toMatchObject({ ok: false, code: 'already-executed' })
    expect(pveCalls('POST', '/snapshot')).toHaveLength(1)

    const ai = await rows('ai.action')

    expect(ai.map(r => (r.details as Record<string, unknown>).outcome)).toEqual(['dispatched', 'refused'])
    expect(ai[1]).toMatchObject({ status: 'failure' })
    expect(ai[1].details).toMatchObject({ code: 'already-executed', actionId: c.actionId, httpStatus: 409 })
  })

  it('serialises a double click: one dispatch, the other refused', async () => {
    const c = snapCard()
    const [a, b] = await Promise.all([run(c), run(c)])

    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(pveCalls('POST', '/snapshot')).toHaveLength(1)
  })

  it('lets a card whose dispatch the route refused be tried again', async () => {
    h.denied.add('vm.snapshot|c1:pve1:qemu:104')
    const c = snapCard()

    expect((await run(c)).status).toBe(403)
    h.denied.clear()
    expect((await run(c)).status).toBe(200)
  })

  // Review Focus 4
  it('refuses a kind disabled after the proposal: 403 action-disabled, nothing dispatched', async () => {
    const c = snapCard()

    await enable({ actions: { snapshot: false, reboot: true } })
    const res = await run(c)

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ ok: false, code: 'action-disabled' })
    expect(pveCalls('POST', '/snapshot')).toHaveLength(0)
    expect((await rows('ai.action'))[0].details).toMatchObject({ outcome: 'refused', code: 'action-disabled' })
  })

  it('refuses every kind when the master switch is off', async () => {
    await enable({ enabled: false })

    expect((await run(snapCard())).body.code).toBe('action-disabled')
  })

  // Review Focus 2
  it('refuses a guest that moved since the card: 409 target-changed', async () => {
    const c = snapCard()

    h.snapshot = snapshot([guest('104', 'win2025', 'qemu', 'running', 'pve2')])
    const res = await run(c)

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ ok: false, code: 'target-changed' })
    expect(res.body.message).toContain('pve2')
    expect(pveCalls('POST', '/snapshot')).toHaveLength(0)
  })

  it('refuses a vmid now held by another guest: 409 target-changed', async () => {
    h.snapshot = snapshot([guest('104', 'other-vm', 'qemu', 'running', 'pve1')])

    expect((await run(snapCard())).body.code).toBe('target-changed')
  })

  it('refuses a guest that stopped since the card through the replayed preflight: 409 preflight-failed', async () => {
    const c = card('reboot', WIN)

    h.snapshot = snapshot([guest('104', 'win2025', 'qemu', 'stopped', 'pve1')])
    const res = await run(c, { confirmed: true })

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ ok: false, code: 'preflight-failed' })
    expect(res.body.message).toBe('win2025 (104) is stopped: only a running guest can be rebooted.')
    expect(res.body.checks).toEqual([{ level: 'block', text: res.body.message }])
    expect(pveCalls('POST', '/status/reboot')).toHaveLength(0)
  })

  it('refuses a guest the caller no longer sees: 404 out-of-scope', async () => {
    h.snapshot = snapshot([guest('205', 'ct-web', 'lxc', 'running', 'pve1')])
    const res = await run(snapCard())

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ ok: false, code: 'out-of-scope' })
  })

  it('asks for the confirmation of a reboot, then runs it once confirmed', async () => {
    const c = card('reboot', WIN)
    const first = await run(c)

    expect(first.status).toBe(400)
    expect(first.body).toMatchObject({ ok: false, code: 'confirmation-required' })
    expect(pveCalls('POST', '/status/reboot')).toHaveLength(0)

    const res = await run(c, { confirmed: true })

    expect(res.status).toBe(200)
    expect(res.body.result).toMatchObject({ upid: 'UPID:pve1:00002:reboot', node: 'pve1', connId: 'c1' })
    expect(pveCalls('POST', '/nodes/pve1/qemu/104/status/reboot')).toHaveLength(1)
    expect((await rows('reboot'))[0].details).toMatchObject({ via: 'assistant', actionId: c.actionId })
  })

  it('does not take a confirmation that is not literally true', async () => {
    expect((await run(card('shutdown', WIN), { confirmed: 'yes' })).body.code).toBe('confirmation-required')
  })

  // Review Focus 5
  it('relays the 403 of the existing route as is, and audits it tagged', async () => {
    h.denied.add('vm.restart|c1:pve1:qemu:104')
    const c = card('reboot', WIN)
    const res = await run(c, { confirmed: true })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ ok: false, code: 'route-refused', message: 'Forbidden: missing vm.restart', httpStatus: 403 })
    expect(pveCalls('POST', '/status/reboot')).toHaveLength(0)

    const net = await rows('execute')

    expect(net[0]).toMatchObject({ status: 'failure', errorMessage: 'Forbidden: missing vm.restart' })
    expect(net[0].details).toMatchObject({ route: '/api/v1/connections/c1/guests/qemu/pve1/104/reboot', httpStatus: 403, via: 'assistant', actionId: c.actionId })

    const [ai] = await rows('ai.action')

    expect(ai).toMatchObject({ status: 'failure', errorMessage: 'Forbidden: missing vm.restart' })
    expect(ai.details).toMatchObject({ outcome: 'dispatched', httpStatus: 403 })
  })

  it('refuses a restricted user a guest outside the view it was proposed in: 404 out-of-scope', async () => {
    h.snapshot = snapshot([guest('205', 'ct-web', 'lxc', 'running', 'pve1')])

    expect((await run(card('start', { ...WIN, vmid: 101, node: 'pve2', name: 'db-01' }))).status).toBe(404)
  })

  it('relays a 500 of the existing route with its message', async () => {
    h.pveFetch.mockImplementationOnce(async () => {
      throw new Error('PVE said no')
    })
    const res = await run(snapCard())

    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ ok: false, code: 'route-refused', message: 'PVE said no', httpStatus: 500 })
  })

  it('refuses the 6th action of a conversation capped at 5: 429 cap-reached', async () => {
    for (let i = 0; i < 5; i++) expect((await run(snapCard())).status).toBe(200)

    const sixth = await run(snapCard())

    expect(sixth.status).toBe(429)
    expect(sixth.body).toMatchObject({ ok: false, code: 'cap-reached' })
    expect(pveCalls('POST', '/snapshot')).toHaveLength(5)
  })

  it('counts the cap per user: another user reusing the conversation id is not capped', async () => {
    for (let i = 0; i < 5; i++) expect((await run(snapCard())).status).toBe(200)

    h.principal = { kind: 'session', userId: 'u2', userEmail: 'u2@test.local', tenantId: 'default', connectionIds: null }
    const other = { ...bind, userId: 'u2' }
    const res = await run(card('snapshot', WIN, { name: 'from-u2' }, {}, other))

    expect(res.status).toBe(200)
    expect((await rows('ai.action')).map(r => r.userId)).toEqual(['u1', 'u1', 'u1', 'u1', 'u1', 'u2'])
  })

  it('does not let another user unlock the next step of a plan with the same plan id', async () => {
    const step1 = card('backup_add', CT, { jobId: 'nightly' }, { planId: 'plan-x', step: 1 })

    expect((await run(step1)).status).toBe(200)

    h.principal = { kind: 'session', userId: 'u2', tenantId: 'default', connectionIds: null }
    const step2 = card('backup_add', CT, { jobId: 'nightly' }, { planId: 'plan-x', step: 2, after: 1 }, { ...bind, userId: 'u2' })

    expect((await run(step2)).body.code).toBe('previous-step-pending')
  })

  it('answers a generic 500 for a failure after verification, and still writes the ai.action row', async () => {
    h.snapshotError = new Error('PrismaClientKnownRequestError: connection to 10.0.0.5:5432 refused, APP_SECRET=abc')
    const c = snapCard()
    const res = await run(c)

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ ok: false, code: 'internal-error', message: 'The action could not be run. Try again.' })
    expect(JSON.stringify(res.body)).not.toMatch(/Prisma|10\.0\.0\.5|APP_SECRET/)

    const ai = await rows('ai.action')

    expect(ai).toHaveLength(1)
    expect(ai[0]).toMatchObject({ status: 'failure', userId: 'u1', errorMessage: 'The action could not be run. Try again.' })
    expect(ai[0].details).toMatchObject({ outcome: 'refused', code: 'internal-error', httpStatus: 500, actionId: c.actionId, conversationId: CONV })
    expect(pveCalls('POST', '/snapshot')).toHaveLength(0)
  })

  it('counts only the dispatches that succeeded toward the cap', async () => {
    await enable({ maxPerConversation: 1 })

    // The route refuses the first one twice: nothing ran, nothing spent.
    for (let i = 0; i < 2; i++) {
      h.pveFetch.mockImplementationOnce(async () => {
        throw new Error('PVE said no')
      })
      expect((await run(snapCard())).body.code).toBe('route-refused')
    }

    expect((await run(snapCard())).status).toBe(200)
    expect((await run(snapCard())).body.code).toBe('cap-reached')
    expect((await rows('ai.action')).map(r => [r.details && (r.details as any).outcome, r.status])).toEqual([
      ['dispatched', 'failure'],
      ['dispatched', 'failure'],
      ['dispatched', 'success'],
      ['refused', 'failure'],
    ])
  })

  it('counts the cap per conversation', async () => {
    await enable({ maxPerConversation: 1 })
    expect((await run(snapCard())).status).toBe(200)

    const other = { ...bind, conversationId: 'conv-2' }

    expect((await execute({ card: card('snapshot', WIN, { name: 'second' }, {}, other), conversationId: 'conv-2' })).status).toBe(200)
    expect((await run(snapCard())).body.code).toBe('cap-reached')
  })

  it('refuses a tampered card: 400 bad-signature, audited without its claims', async () => {
    const c = snapCard()
    const res = await run({ ...c, target: { ...c.target, vmid: 101 } })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ ok: false, code: 'bad-signature' })

    const [ai] = await rows('ai.action')

    expect(ai.details).toEqual({ via: 'assistant', outcome: 'refused', code: 'bad-signature', httpStatus: 400 })
  })

  it('refuses a card of another conversation and an expired card', async () => {
    const c = snapCard()

    expect((await execute({ card: c, conversationId: 'conv-2' })).body.code).toBe('bad-signature')
    expect((await run(snapCard({ expiresAt: Date.now() - 1 }))).body.code).toBe('expired')
  })

  it('refuses a card issued to another user', async () => {
    h.principal = { kind: 'session', userId: 'u2', tenantId: 'default', connectionIds: null }

    expect((await run(snapCard())).body.code).toBe('bad-signature')
  })

  it('refuses an API token: 403 session-required', async () => {
    h.principal = { kind: 'token', tokenId: 'tok', tenantId: 'default', connectionIds: null }
    const res = await run(snapCard())

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ ok: false, code: 'session-required' })
  })

  it('refuses a malformed body: 400 bad-request', async () => {
    expect((await execute({ card: snapCard() })).body.code).toBe('bad-request')
    expect((await execute({ card: 'x', conversationId: CONV })).body.code).toBe('bad-request')
    expect((await execute([1])).status).toBe(400)
  })

  it('refuses without either feature, and without connection.view', async () => {
    h.features = new Set(['ai_insights'])
    expect(await run(snapCard())).toMatchObject({ status: 403, body: { ok: false, code: 'not-licensed' } })

    h.features = new Set(['ai_actions'])
    expect((await run(snapCard())).body.code).toBe('not-licensed')

    h.features = new Set(['ai_insights', 'ai_actions'])
    h.denied.add('connection.view|*')
    expect(await run(snapCard())).toMatchObject({ status: 403, body: { ok: false, code: 'forbidden' } })
    expect(pveCalls('POST', '/snapshot')).toHaveLength(0)
  })

  describe('plans (R12)', () => {
    const planned = (step: number, after?: number) =>
      card('backup_add', CT, { jobId: 'nightly' }, { planId: 'plan-1', step, ...(after === undefined ? {} : { after }) })

    it('refuses a step before the one it waits for: 409 previous-step-pending, then runs it', async () => {
      const second = planned(2, 1)
      const early = await run(second)

      expect(early.status).toBe(409)
      expect(early.body).toMatchObject({ ok: false, code: 'previous-step-pending' })

      const first = await run(planned(1))

      expect(first.status).toBe(200)
      expect(first.body.result).toEqual({ node: 'pve1', connId: 'c1', message: 'Done: add ct-web (205) to backup job nightly' })
      expect(pveCalls('PUT', '/cluster/backup/nightly')).toHaveLength(1)

      expect((await run(second)).status).toBe(200)
    })

    it('keeps the next step locked while the previous one failed', async () => {
      h.denied.add('backup.job.edit|c1')
      expect((await run(planned(1))).status).toBe(403)
      h.denied.clear()

      expect((await run(planned(2, 1))).body.code).toBe('previous-step-pending')
    })

    it('tags the backup job row with the backups category', async () => {
      expect((await run(planned(1))).status).toBe(200)
      expect((await rows('ai.action'))[0]).toMatchObject({ category: 'backups' })
      expect((await rows('update'))[0].details).toMatchObject({ operation: 'add_guest', via: 'assistant' })
    })
  })

  describe('migrate', () => {
    it('replays the Proxmox precondition, then starts the live move', async () => {
      const res = await run(card('migrate', WIN, { target: 'pve2', online: true }))

      expect(res.status).toBe(200)
      expect(res.body.result).toMatchObject({ upid: 'UPID:pve1:00003:migrate', node: 'pve1' })
      expect(pveCalls('GET', '/nodes/pve1/qemu/104/migrate')).toHaveLength(1)

      const [post] = pveCalls('POST', '/nodes/pve1/qemu/104/migrate')
      const sent = new URLSearchParams(post[2]?.body)

      expect(sent.get('target')).toBe('pve2')
      expect(sent.get('online')).toBe('1')
      expect((await rows('migrate'))[0].details).toMatchObject({ targetNode: 'pve2', via: 'assistant' })
    })

    it('refuses a move Proxmox now blocks: 409 preflight-failed', async () => {
      h.pveFetch.mockImplementation(async (_conn, path, init) => {
        if ((init?.method ?? 'GET') === 'GET' && path.endsWith('/migrate')) {
          return { ...PRECONDITION, local_disks: [{ volid: 'local-lvm:vm-104-disk-0' }] }
        }

        throw new Error(`unexpected ${path}`)
      })
      const res = await run(card('migrate', WIN, { target: 'pve2', online: true }))

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('preflight-failed')
      expect(res.body.message).toContain('local storage')
      expect(pveCalls('POST', '/migrate')).toHaveLength(0)
    })
  })

  describe('drs_apply (R14)', () => {
    const rec = (over: Record<string, unknown> = {}) => ({
      id: 'rec-1', status: 'pending', connection_id: 'c1', vmid: 104, source_node: 'pve1', target_node: 'pve3', priority: 'high', ...over,
    })

    it('executes the recommendation through the DRS route, its safety-net row tagged', async () => {
      h.client.getRecommendations.mockResolvedValue({ data: [rec()] })
      const c = card('drs_apply', WIN, { recommendationId: 'rec-1' })
      const res = await run(c)

      expect(res.status).toBe(200)
      expect(h.client.executeRecommendation).toHaveBeenCalledWith('rec-1')

      const [net] = await rows('execute')

      expect(net).toMatchObject({ category: 'automation', resourceId: 'rec-1', status: 'success' })
      expect(net.details).toMatchObject({ route: '/api/v1/orchestrator/drs/recommendations/rec-1/execute', via: 'assistant', actionId: c.actionId })
      expect((await rows('ai.action'))[0]).toMatchObject({ category: 'automation' })
    })

    it('refuses a recommendation now about another guest: 409 target-changed', async () => {
      h.client.getRecommendations.mockResolvedValue({ data: [rec({ vmid: 205 })] })
      const res = await run(card('drs_apply', WIN, { recommendationId: 'rec-1' }))

      expect(res.status).toBe(409)
      expect(res.body.code).toBe('target-changed')
      expect(h.client.executeRecommendation).not.toHaveBeenCalled()
    })
  })

  describe('maintenance', () => {
    it('enters maintenance over SSH once confirmed, under the nodes category', async () => {
      const c = card('maintenance', HOST2, { mode: 'enter' })
      const res = await run(c, { confirmed: true })

      expect(res.status).toBe(200)
      expect(res.body.result).toEqual({ node: 'pve2', connId: 'c1', message: 'Done: put pve2 in maintenance' })
      expect(h.executeSSH).toHaveBeenCalledWith('c1', expect.anything(), 'ha-manager crm-command node-maintenance enable pve2')

      const [net] = await rows('maintenance')

      expect(net).toMatchObject({ category: 'nodes', resourceId: 'pve2' })
      expect(net.details).toMatchObject({ method: 'POST', via: 'assistant', actionId: c.actionId })
      expect((await rows('ai.action'))[0]).toMatchObject({ category: 'nodes', resourceType: 'node', resourceId: 'pve2' })
      expect(h.invalidateInventoryCache).toHaveBeenCalledTimes(1)
    })

    it('leaves the inventory cache alone when the maintenance route fails', async () => {
      h.executeSSH.mockResolvedValue({ success: false, error: 'ssh: connection refused' })
      const res = await run(card('maintenance', HOST2, { mode: 'enter' }), { confirmed: true })

      expect(res.status).toBe(500)
      expect(res.body.code).toBe('route-refused')
      expect(h.invalidateInventoryCache).not.toHaveBeenCalled()
    })

    it('exits maintenance with DELETE', async () => {
      h.snapshot = snapshot(undefined, [node('pve1'), node('pve2', { maintenance: 'maintenance' }), node('pve3')])
      const res = await run(card('maintenance', HOST2, { mode: 'exit' }), { confirmed: true })

      expect(res.status).toBe(200)
      expect(h.executeSSH).toHaveBeenCalledWith('c1', expect.anything(), 'ha-manager crm-command node-maintenance disable pve2')
      expect((await rows('maintenance'))[0].details).toMatchObject({ method: 'DELETE' })
    })

    it('refuses a host the caller no longer sees', async () => {
      h.snapshot = snapshot(undefined, [node('pve1'), node('pve3')])

      expect((await run(card('maintenance', HOST2, { mode: 'enter' }), { confirmed: true })).status).toBe(404)
    })
  })

  it('starts a container with the lxc path and the containers category', async () => {
    h.snapshot = snapshot([guest('205', 'ct-web', 'lxc', 'stopped', 'pve1')])
    const res = await run(card('start', CT))

    expect(res.status).toBe(200)
    expect(pveCalls('POST', '/nodes/pve1/lxc/205/status/start')).toHaveLength(1)
    expect((await rows('ai.action'))[0]).toMatchObject({ category: 'containers', resourceType: 'lxc' })
  })
})
