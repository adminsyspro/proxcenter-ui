import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  requireFeature: vi.fn(),
  checkPermission: vi.fn(),
  checkPermissions: vi.fn(),
  findUnique: vi.fn(),
  getConn: vi.fn(),
  pveFetch: vi.fn(),
  audit: vi.fn(),
  locale: vi.fn(),
  renderPdf: vi.fn(),
  client: {
    listRestoreDrills: vi.fn(),
    preflightRestoreDrill: vi.fn(),
    createRestoreDrill: vi.fn(),
    getRestoreDrill: vi.fn(),
    cancelRestoreDrill: vi.fn(),
    cleanupRestoreDrill: vi.fn(),
    getRestoreDrillSettings: vi.fn(),
    updateRestoreDrillSettings: vi.fn(),
    listRestoreDrillSchedules: vi.fn(),
    createRestoreDrillSchedule: vi.fn(),
    getRestoreDrillSchedule: vi.fn(),
    updateRestoreDrillSchedule: vi.fn(),
    deleteRestoreDrillSchedule: vi.fn(),
    runRestoreDrillSchedule: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ requireFeature: (id: string) => m.requireFeature(id) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_BACKUP: 'vm.backup', BACKUP_RESTORE: 'backup.restore', BACKUP_VIEW: 'backup.view', ADMIN_SETTINGS: 'admin.settings' },
  buildNodeResourceId: (c: string, n: string) => `${c}:${n}`,
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
  checkPermissions: (...a: unknown[]) => m.checkPermissions(...a),
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findUnique: (...a: unknown[]) => m.findUnique(...a) } } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionByIdOrNull: (...a: unknown[]) => m.getConn(...a) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pveFetch(...a) }))
vi.mock('@/lib/audit', async () => {
  // audit() flips the request's audit scope so withAudit() adds no row of its
  // own (#1105); the stand-in must do the same or every explicit row doubles.
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return m.audit(...a) } }
})
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => (name === 'NEXT_LOCALE' && m.locale() ? { value: m.locale() } : undefined) }) }))
vi.mock('@/lib/reporting/weasyprintClient', () => ({ renderPdf: (...a: unknown[]) => m.renderPdf(...a) }))
vi.mock('@/lib/reporting/reportBranding', () => ({ resolveReportBranding: async () => ({ brandColor: '#E57000', logoDataUri: '', appName: '' }) }))
vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  getOrchestratorClient: () => m.client,
}))

const ID = '1a2b3c4d-0000-4000-8000-000000000000'
const BODY = {
  pbsId: 'pbs-1', datastore: 'store1', namespace: 'prod', backupType: 'vm', backupId: '101',
  backupTime: '2026-10-18T02:00:05Z', vmName: 'web01', verifyState: 'ok', verifiedAt: '2026-10-18T03:00:00Z',
  backupSize: 1000, targetConnectionId: 'conn-1', targetNode: 'pve1', targetStorage: 'local-lvm',
  networkMode: 'link_down', restoreTimeoutSec: 0, bootTimeoutSec: 0, agentTimeoutSec: 0,
}
const STORAGES = [
  { storage: 'pbs-prod', type: 'pbs', server: 'pbs.lab', datastore: 'store1', namespace: 'prod' },
  { storage: 'local-lvm', type: 'lvmthin' },
]
const DRILL = { id: ID, status: 'failed', connection_id: 'conn-1', node: 'pve1', temp_vmid: 9001, temp_name: 'drill-101-1a2b3c4d', source: { vm_name: 'web01' } }
const SCHEDULE_BODY = {
  name: 'Nightly PBS check', enabled: true, scope: { mode: 'vms', vmids: [9882, 100, 100] }, restore_point: 'latest_verified',
  source: { pbs_id: 'pbs-1', datastore: 'store1', namespace: '/prod/', pbs_storage: 'forged', pbs_name: 'forged' },
  connection_id: 'conn-1', node: 'pve1', target_storage: 'local-lvm', network_mode: 'link_down', bridge: 'ignored',
  calendar: 'mon..fri  02:00', vms_per_run: 2, created_by: 'forged@x',
}
const SCHEDULE = {
  id: ID, name: 'Nightly PBS check', enabled: true, scope: { mode: 'vms', vmids: [100, 9882] }, restore_point: 'latest_verified',
  source: { pbs_id: 'pbs-1', pbs_name: 'PBS lab', pbs_storage: 'pbs-prod', datastore: 'store1', namespace: 'prod' },
  connection_id: 'conn-1', node: 'pve2', target_storage: 'local-lvm', network_mode: 'link_down', bridge: '',
  calendar: '02:00', vms_per_run: 1, created_by: 'admin@lab', rotation_last_vmid: 0, next_run_at: '', last_run: null,
  created_at: '', updated_at: '',
}
const RUN = { id: 'r1', schedule_id: ID, started_at: '', state: 'running', result: '', summary: '', drill_ids: [], skipped_vmids: [] }
const denied = (status = 403) => NextResponse.json({ error: 'Forbidden' }, { status })
const orchestratorError = (status: number, body: unknown) => new Error(`Orchestrator ${status}: ${JSON.stringify(body)}`)

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u1', email: 'admin@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.requireFeature.mockResolvedValue(null)
  m.checkPermission.mockResolvedValue(null)
  m.checkPermissions.mockResolvedValue(null)
  m.findUnique.mockResolvedValue({ name: 'PBS lab', baseUrl: 'https://pbs.lab:8007', type: 'pbs' })
  m.getConn.mockResolvedValue({ id: 'conn-1' })
  m.pveFetch.mockResolvedValue(STORAGES)
  m.audit.mockResolvedValue('a1')
  m.locale.mockReturnValue(undefined)
  m.renderPdf.mockResolvedValue({ ok: true, pdf: Buffer.from('%PDF-1.7 drill') })
  m.client.listRestoreDrills.mockResolvedValue({ data: { data: [DRILL], total: 41 }, status: 200 })
  m.client.preflightRestoreDrill.mockResolvedValue({ data: { ok: true, required_bytes: 1, temp_vmid: 9001, checks: [] }, status: 200 })
  m.client.createRestoreDrill.mockResolvedValue({ data: { drill: { ...DRILL, status: 'queued' } }, status: 200 })
  m.client.getRestoreDrill.mockResolvedValue({ data: { drill: DRILL, events: [{ ts: 't', level: 'info', stage: '', message: 'm' }] }, status: 200 })
  m.client.cancelRestoreDrill.mockResolvedValue({ data: { drill: DRILL }, status: 200 })
  m.client.cleanupRestoreDrill.mockResolvedValue({ data: { drill: DRILL }, status: 200 })
  m.client.getRestoreDrillSettings.mockResolvedValue({ data: { max_concurrent: 1 }, status: 200 })
  m.client.updateRestoreDrillSettings.mockImplementation(async (s: unknown) => ({ data: s, status: 200 }))
  m.client.listRestoreDrillSchedules.mockResolvedValue({ data: { data: [SCHEDULE], total: 3 }, status: 200 })
  m.client.createRestoreDrillSchedule.mockImplementation(async (s: any) => ({ data: { schedule: { ...s, id: ID } }, status: 200 }))
  m.client.getRestoreDrillSchedule.mockResolvedValue({ data: { schedule: SCHEDULE, runs: [RUN], events: [] }, status: 200 })
  m.client.updateRestoreDrillSchedule.mockImplementation(async (_id: string, s: any) => ({ data: { schedule: { ...s, id: ID } }, status: 200 }))
  m.client.deleteRestoreDrillSchedule.mockResolvedValue({ data: undefined, status: 200 })
  m.client.runRestoreDrillSchedule.mockResolvedValue({ data: { run: RUN }, status: 200 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const routes = {
  list: async () => (await import('./route')).GET,
  create: async () => (await import('./route')).POST,
  preflight: async () => (await import('./preflight/route')).POST,
  settingsGet: async () => (await import('./settings/route')).GET,
  settingsPut: async () => (await import('./settings/route')).PUT,
  get: async () => (await import('./[id]/route')).GET,
  cancel: async () => (await import('./[id]/cancel/route')).POST,
  cleanup: async () => (await import('./[id]/cleanup/route')).POST,
  evidence: async () => (await import('./[id]/evidence/route')).GET,
  screenshot: async () => (await import('./[id]/screenshot/route')).GET,
  schedulesList: async () => (await import('./schedules/route')).GET,
  scheduleCreate: async () => (await import('./schedules/route')).POST,
  scheduleGet: async () => (await import('./schedules/[id]/route')).GET,
  scheduleUpdate: async () => (await import('./schedules/[id]/route')).PUT,
  scheduleDelete: async () => (await import('./schedules/[id]/route')).DELETE,
  scheduleRun: async () => (await import('./schedules/[id]/run/route')).POST,
}

const METHODS: Partial<Record<keyof typeof routes, 'PUT' | 'DELETE' | 'POST'>> = {
  settingsPut: 'PUT', scheduleUpdate: 'PUT', scheduleDelete: 'DELETE', scheduleRun: 'POST',
  cancel: 'POST', cleanup: 'POST',
}
const BODIES: Partial<Record<keyof typeof routes, unknown>> = {
  create: BODY, preflight: BODY, scheduleCreate: SCHEDULE_BODY, scheduleUpdate: SCHEDULE_BODY,
}

async function call(name: keyof typeof routes, opts: Parameters<typeof callRoute>[1] = {}) {
  const handler = await routes[name]()
  return callRoute(handler as any, { params: { id: ID }, ...opts })
}

describe('common gate', () => {
  for (const name of Object.keys(routes) as Array<keyof typeof routes>) {
    const method = METHODS[name]
    const body = BODIES[name] as any

    it(`${name}: 401 without a session`, async () => {
      m.session.mockResolvedValue(null)
      expect((await call(name, { method, body })).status).toBe(401)
    })

    it(`${name}: 404 for a vDC tenant, before the licence and the orchestrator`, async () => {
      m.session.mockResolvedValue({ user: { id: 'u1', email: 'x', tenantId: 'acme' } })
      const res = await call(name, { method, body })
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Not found' })
      expect(m.requireFeature).not.toHaveBeenCalled()
      expect(Object.values(m.client).every(fn => fn.mock.calls.length === 0)).toBe(true)
    })

    it(`${name}: 403 without the feature`, async () => {
      m.requireFeature.mockResolvedValue(NextResponse.json({ error: 'Feature not licensed' }, { status: 403 }))
      expect((await call(name, { method, body })).status).toBe(403)
      expect(m.requireFeature).toHaveBeenCalledWith('backup_restore_drills')
    })
  }

  it('404 when the resolved tenant is not the provider, and when it cannot be resolved', async () => {
    m.tenant.mockResolvedValue('acme')
    expect((await call('list')).status).toBe(404)
    m.tenant.mockRejectedValue(new Error('Invalid or expired API token'))
    expect((await call('list')).status).toBe(404)
  })
})

describe('GET /restore-drills', () => {
  it('lists one page through BACKUP_VIEW, with the total for the pager', async () => {
    const res = await call('list', { searchParams: { limit: '50', offset: '100' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [DRILL], total: 41 })
    expect(m.checkPermission).toHaveBeenCalledWith('backup.view')
    expect(m.client.listRestoreDrills).toHaveBeenCalledWith(50, 100, '')
  })

  it('filters by schedule, never with a malformed id', async () => {
    await call('list', { searchParams: { schedule_id: ID } })
    expect(m.client.listRestoreDrills).toHaveBeenLastCalledWith(20, 0, ID)
    await call('list', { searchParams: { schedule_id: '../x' } })
    expect(m.client.listRestoreDrills).toHaveBeenLastCalledWith(20, 0, '')
  })

  it('bounds the page size and the offset', async () => {
    await call('list', { searchParams: { limit: '9999', offset: '-3' } })
    expect(m.client.listRestoreDrills).toHaveBeenLastCalledWith(100, 0, '')
    await call('list', { searchParams: { limit: 'abc', offset: 'x' } })
    expect(m.client.listRestoreDrills).toHaveBeenLastCalledWith(20, 0, '')
    await call('list')
    expect(m.client.listRestoreDrills).toHaveBeenLastCalledWith(20, 0, '')
  })

  it('refuses without BACKUP_VIEW, and survives an odd payload', async () => {
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('list')).status).toBe(403)
    m.client.listRestoreDrills.mockResolvedValue({ data: {}, status: 200 })
    expect(await (await call('list')).json()).toEqual({ data: [], total: 0 })
  })

  it('answers 503 when the orchestrator is down', async () => {
    const err: any = new Error('Orchestrator unavailable')
    err.code = 'ORCHESTRATOR_UNAVAILABLE'
    m.client.listRestoreDrills.mockRejectedValue(err)
    expect((await call('list')).status).toBe(503)
  })
})

describe('POST /restore-drills and /preflight', () => {
  it('maps the body to the contract with the resolved archive volid', async () => {
    const res = await call('create', { body: BODY })
    expect(res.status).toBe(202)
    expect(m.checkPermissions).toHaveBeenCalledWith(['vm.backup', 'backup.restore'], 'node', 'conn-1:pve1')
    expect(m.checkPermission).toHaveBeenCalledWith('backup.view', 'pbs', 'pbs-1')
    expect(m.pveFetch).toHaveBeenCalledWith({ id: 'conn-1' }, '/storage', {}, { timeoutMs: 10_000 })
    const sent = m.client.createRestoreDrill.mock.calls[0][0]
    expect(sent).toMatchObject({
      connection_id: 'conn-1', node: 'pve1', target_storage: 'local-lvm',
      archive: 'pbs-prod:backup/vm/101/2026-10-18T02:00:05Z', network_mode: 'link_down', bridge: '',
      requested_by: 'admin@lab',
      source: { pbs_id: 'pbs-1', pbs_name: 'PBS lab', pbs_storage: 'pbs-prod', backup_id: '101', verify_state: 'ok' },
    })
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'test', category: 'backups', resourceType: 'restore_drill', resourceId: ID }))
  })

  it('preflight returns the orchestrator answer with the archive', async () => {
    const res = await call('preflight', { body: { ...BODY, networkMode: 'bridge', bridge: 'vmbr9' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, temp_vmid: 9001, archive: 'pbs-prod:backup/vm/101/2026-10-18T02:00:05Z' })
    expect(m.client.preflightRestoreDrill.mock.calls[0][0]).toMatchObject({ network_mode: 'bridge', bridge: 'vmbr9' })
    expect(m.audit).not.toHaveBeenCalled()
  })

  it('refuses a container with the contract message', async () => {
    const res = await call('create', { body: { ...BODY, backupType: 'ct' } })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'guest type ct is not supported by restore drills yet' })
    expect((await call('preflight', { body: { ...BODY, backupType: 'host' } })).status).toBe(422)
    expect(m.client.createRestoreDrill).not.toHaveBeenCalled()
  })

  it('409 when no PVE storage of the cluster points to this PBS datastore and namespace', async () => {
    m.pveFetch.mockResolvedValue([{ storage: 'pbs-other', type: 'pbs', server: 'pbs.lab', datastore: 'store1', namespace: '' }])
    const res = await call('create', { body: BODY })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'No PVE storage of this cluster points to this PBS datastore and namespace' })
  })

  it('refuses a node or PBS the caller has no right on', async () => {
    m.checkPermissions.mockResolvedValueOnce(denied())
    expect((await call('create', { body: BODY })).status).toBe(403)
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('preflight', { body: BODY })).status).toBe(403)
    expect(m.client.createRestoreDrill).not.toHaveBeenCalled()
  })

  it('validates the body', async () => {
    expect((await call('create', { body: { ...BODY, networkMode: 'open' } })).status).toBe(400)
    const handler = await routes.create()
    const res = await handler(new Request('http://test.local/_', { method: 'POST', body: '{nope' }))
    expect(res.status).toBe(400)
    const pre = await routes.preflight()
    expect((await pre(new Request('http://test.local/_', { method: 'POST', body: '{nope' }))).status).toBe(400)
  })

  it('404 for an unknown PBS or target connection, 502 for an unreachable cluster', async () => {
    m.findUnique.mockResolvedValueOnce({ name: 'x', baseUrl: 'https://pve', type: 'pve' })
    expect((await call('create', { body: BODY })).status).toBe(404)
    m.getConn.mockResolvedValueOnce(null)
    expect((await call('create', { body: BODY })).status).toBe(404)
    m.pveFetch.mockRejectedValueOnce(new Error('timeout'))
    const res = await call('create', { body: BODY })
    expect(res.status).toBe(502)
  })

  it('passes the orchestrator 422 with its preflight, and its 409, through', async () => {
    const preflight = { ok: false, required_bytes: 1, temp_vmid: 0, checks: [{ key: 'free_space', status: 'fail', detail: 'not enough' }] }
    m.client.createRestoreDrill.mockRejectedValueOnce(orchestratorError(422, { error: 'preflight failed', preflight }))
    let res = await call('create', { body: BODY })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'preflight failed', preflight })

    m.client.createRestoreDrill.mockRejectedValueOnce(orchestratorError(409, { error: 'concurrency limit reached' }))
    res = await call('create', { body: BODY })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'concurrency limit reached' })
    // The route never reached its own audit(): the refusal rows are withAudit()'s.
    expect(m.audit).toHaveBeenCalledTimes(2)
    expect(m.audit.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({ category: 'backups', action: 'create', resourceType: 'restore_drill', status: 'failure', errorMessage: 'preflight failed', details: expect.objectContaining({ method: 'POST', httpStatus: 422 }) }),
      expect.objectContaining({ category: 'backups', action: 'create', resourceType: 'restore_drill', status: 'failure', errorMessage: 'concurrency limit reached', details: expect.objectContaining({ method: 'POST', httpStatus: 409 }) }),
    ])
  })
})

describe('settings', () => {
  const S = {
    max_concurrent: 2, capacity_budget_gb: 0, free_space_margin_pct: 10, restore_timeout_sec: 14400,
    boot_timeout_sec: 600, agent_timeout_sec: 300, default_network_mode: 'link_down', default_bridge: '',
    screenshot_delay_sec: 45,
  }

  it('reads with BACKUP_VIEW', async () => {
    const res = await call('settingsGet')
    expect(res.status).toBe(200)
    expect(m.checkPermission).toHaveBeenCalledWith('backup.view')
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('settingsGet')).status).toBe(403)
    m.client.getRestoreDrillSettings.mockRejectedValueOnce(new Error('boom'))
    expect((await call('settingsGet')).status).toBe(500)
  })

  it('writes with ADMIN_SETTINGS, validated and audited', async () => {
    const res = await call('settingsPut', { method: 'PUT', body: S })
    expect(res.status).toBe(200)
    expect(m.checkPermission).toHaveBeenCalledWith('admin.settings')
    expect(m.client.updateRestoreDrillSettings).toHaveBeenCalledWith(S)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resourceType: 'restore_drill_settings' }))
  })

  it('refuses a bad row, a bad body and a missing right', async () => {
    expect((await call('settingsPut', { method: 'PUT', body: { ...S, max_concurrent: 11 } })).status).toBe(400)
    const put = await routes.settingsPut()
    expect((await put(new Request('http://test.local/_', { method: 'PUT', body: 'x' }))).status).toBe(400)
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('settingsPut', { method: 'PUT', body: S })).status).toBe(403)
    m.client.updateRestoreDrillSettings.mockRejectedValueOnce(orchestratorError(400, { error: 'out of range' }))
    expect((await call('settingsPut', { method: 'PUT', body: S })).status).toBe(400)
  })
})

describe('one drill', () => {
  it('returns the drill and its events', async () => {
    const res = await call('get')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ drill: { id: ID }, events: [{ message: 'm' }] })
    m.client.getRestoreDrill.mockResolvedValueOnce({ data: { drill: DRILL }, status: 200 })
    expect((await (await call('get')).json()).events).toEqual([])
  })

  it('404 for a malformed id or an unknown drill', async () => {
    expect((await call('get', { params: { id: '../x' } })).status).toBe(404)
    m.client.getRestoreDrill.mockRejectedValueOnce(orchestratorError(404, { error: 'drill not found' }))
    expect((await call('get')).status).toBe(404)
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('get')).status).toBe(403)
  })
})

describe('cancel and cleanup', () => {
  it.each([
    ['cancel', 'cancelRestoreDrill', 'stop'],
    ['cleanup', 'cleanupRestoreDrill', 'delete'],
  ] as const)('%s is judged on the drill node and audited', async (name, method, action) => {
    const res = await call(name)
    expect(res.status).toBe(202)
    expect(m.checkPermission).toHaveBeenCalledWith('backup.restore', 'node', 'conn-1:pve1')
    expect(m.client[method]).toHaveBeenCalledWith(ID)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action, resourceId: ID, resourceType: 'restore_drill' }))
  })

  it('refuses without the right on the node, and for an unknown drill', async () => {
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('cancel')).status).toBe(403)
    expect(m.client.cancelRestoreDrill).not.toHaveBeenCalled()
    m.client.getRestoreDrill.mockResolvedValueOnce({ data: {}, status: 200 })
    expect((await call('cleanup')).status).toBe(404)
    expect((await call('cleanup', { params: { id: 'a b' } })).status).toBe(404)
  })

  it('passes the orchestrator 409 through', async () => {
    m.client.cleanupRestoreDrill.mockRejectedValueOnce(orchestratorError(409, { error: 'cleanup is not failed' }))
    const res = await call('cleanup')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'cleanup is not failed' })
    m.client.cancelRestoreDrill.mockRejectedValueOnce(orchestratorError(409, { error: 'not active' }))
    expect((await call('cancel')).status).toBe(409)
  })
})

describe('evidence', () => {
  const EVIDENCE = {
    format: 'proxcenter-restore-drill-evidence/v1',
    drill: { ...DRILL, source: { ...(DRILL as any).source, vm_name: 'web<01>' } },
    events: [{ ts: '2026-10-18T19:01:00Z', level: 'info', stage: 'restore_completed', message: 'restore task started' }],
    restore_task: { upid: 'UPID:x', exit_status: 'OK', log_tail: ['progress 100%'] },
  }

  it('renders one PDF in the reader language, named after the drill', async () => {
    m.locale.mockReturnValue('fr')
    m.findUnique.mockResolvedValue({ name: 'PVE-PROD' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(EVIDENCE), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await call('evidence')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="restore-drill-web-01-1a2b3c4d-\d{4}-\d{2}-\d{2}\.pdf"$/)
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('%PDF-1.7 drill')
    expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/api/v1/restore-drills/${ID}/evidence$`))
    const html = m.renderPdf.mock.calls[0][0] as string
    expect(html).toContain('<html lang="fr">')
    expect(html).toContain('Preuve d&#39;exercice de restauration')
    expect(html).toContain('web&lt;01&gt;')
    expect(html).toContain('PVE-PROD')
    expect(html).not.toContain('web<01>')
  })

  it('answers like the compliance report when the renderer is out of reach, never with JSON evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(EVIDENCE), { status: 200 })))
    m.renderPdf.mockResolvedValueOnce({ ok: false, error: 'renderer timed out' })
    let res = await call('evidence')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'renderer timed out' })
    m.renderPdf.mockResolvedValueOnce({ ok: false })
    res = await call('evidence')
    expect(await res.json()).toEqual({ error: 'PDF generation failed' })
  })

  it('relays the orchestrator errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"error":"drill not found"}', { status: 404 })))
    let res = await call('evidence')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'drill not found' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('plain failure', { status: 500 })))
    res = await call('evidence')
    expect(await res.json()).toEqual({ error: 'plain failure' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 })))
    expect((await call('evidence')).status).toBe(502)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('fetch failed')))
    expect((await call('evidence')).status).toBe(503)
    expect(m.renderPdf).not.toHaveBeenCalled()
  })

  it('needs BACKUP_VIEW and a well-formed id', async () => {
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('evidence')).status).toBe(403)
    expect((await call('evidence', { params: { id: '../../x' } })).status).toBe(404)
  })
})

describe('screenshot', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

  it('relays the PNG bytes, privately cacheable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await call('screenshot')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
    expect(m.checkPermission).toHaveBeenCalledWith('backup.view')
    expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/api/v1/restore-drills/${ID}/screenshot$`))
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
  })

  it('404 when the drill has no screenshot, other refusals relayed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"error":"screenshot not found"}', { status: 404 })))
    let res = await call('screenshot')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Screenshot not found' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"error":"database is locked"}', { status: 500 })))
    res = await call('screenshot')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'database is locked' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 502 })))
    res = await call('screenshot')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Orchestrator error 502' })
  })

  it('503 when the orchestrator is out of reach', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('fetch failed')))
    const res = await call('screenshot')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Orchestrator unavailable', code: 'ORCHESTRATOR_UNAVAILABLE' })
  })

  it('needs BACKUP_VIEW and a well-formed id, before the orchestrator', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('screenshot')).status).toBe(403)
    expect((await call('screenshot', { params: { id: '../../x' } })).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 500 on an unexpected failure', async () => {
    m.checkPermission.mockRejectedValueOnce(new Error('boom'))
    expect((await call('screenshot')).status).toBe(500)
  })
})

describe('schedules', () => {
  it('lists one page through BACKUP_VIEW, with the total for the pager', async () => {
    const res = await call('schedulesList', { searchParams: { limit: '50', offset: '50' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [SCHEDULE], total: 3 })
    expect(m.checkPermission).toHaveBeenCalledWith('backup.view')
    expect(m.client.listRestoreDrillSchedules).toHaveBeenCalledWith(50, 50)
    await call('schedulesList', { searchParams: { limit: '999', offset: '-1' } })
    expect(m.client.listRestoreDrillSchedules).toHaveBeenLastCalledWith(100, 0)
    m.client.listRestoreDrillSchedules.mockResolvedValueOnce({ data: null, status: 200 })
    expect(await (await call('schedulesList')).json()).toEqual({ data: [], total: 0 })
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('schedulesList')).status).toBe(403)
  })

  it('creates with the rights of a drill, the resolved PBS storage and the caller as author', async () => {
    const res = await call('scheduleCreate', { body: SCHEDULE_BODY })
    expect(res.status).toBe(201)
    expect(m.checkPermissions).toHaveBeenCalledWith(['vm.backup', 'backup.restore'], 'node', 'conn-1:pve1')
    expect(m.checkPermission).toHaveBeenCalledWith('backup.view', 'pbs', 'pbs-1')
    expect(m.client.createRestoreDrillSchedule).toHaveBeenCalledWith({
      name: 'Nightly PBS check', enabled: true, scope: { mode: 'vms', vmids: [100, 9882] }, restore_point: 'latest_verified',
      source: { pbs_id: 'pbs-1', pbs_name: 'PBS lab', pbs_storage: 'pbs-prod', datastore: 'store1', namespace: 'prod' },
      connection_id: 'conn-1', node: 'pve1', target_storage: 'local-lvm', network_mode: 'link_down', bridge: '',
      calendar: 'mon..fri 02:00', vms_per_run: 2, created_by: 'admin@lab',
    })
    expect((await res.json()).schedule.id).toBe(ID)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', category: 'backups', resourceType: 'restore_drill_schedule', resourceId: ID, resourceName: 'Nightly PBS check',
    }))
  })

  it('an "all" scope drops the VM list, a bridge is kept in bridge mode', async () => {
    await call('scheduleCreate', { body: { ...SCHEDULE_BODY, scope: { mode: 'all', vmids: [1] }, network_mode: 'bridge', bridge: 'vmbr9' } })
    const sent = m.client.createRestoreDrillSchedule.mock.calls[0][0]
    expect(sent.scope).toEqual({ mode: 'all', vmids: [] })
    expect(sent.bridge).toBe('vmbr9')
    expect(m.audit.mock.calls[0][0].details).toMatchObject({ scope: 'all', bridge: 'vmbr9' })
  })

  it.each([
    ['an empty name', { name: '  ' }],
    ['a long name', { name: 'x'.repeat(101) }],
    ['a non boolean enabled', { enabled: 'yes' }],
    ['an unknown scope', { scope: { mode: 'some' } }],
    ['no VM in a vms scope', { scope: { mode: 'vms', vmids: [] } }],
    ['a VM list that is not an array', { scope: { mode: 'vms', vmids: '100' } }],
    ['a non integer vmid', { scope: { mode: 'vms', vmids: [1.5] } }],
    ['too many VMs', { scope: { mode: 'vms', vmids: Array.from({ length: 501 }, (_, i) => i + 1) } }],
    ['an unknown restore point', { restore_point: 'oldest' }],
    ['a missing PBS', { source: { datastore: 'store1' } }],
    ['a bad node', { node: '-x' }],
    ['a bad storage', { target_storage: 'a b' }],
    ['an unknown network mode', { network_mode: 'open' }],
    ['a bridge mode without bridge', { network_mode: 'bridge', bridge: '' }],
    ['an empty calendar', { calendar: ' ' }],
    ['a huge calendar', { calendar: '1'.repeat(201) }],
    ['zero VM per pass', { vms_per_run: 0 }],
    ['51 VMs per pass', { vms_per_run: 51 }],
  ])('400 for %s, before any right or the orchestrator', async (_label, patch) => {
    const res = await call('scheduleCreate', { body: { ...SCHEDULE_BODY, ...patch } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBeTypeOf('string')
    expect(m.checkPermissions).not.toHaveBeenCalled()
    expect(m.client.createRestoreDrillSchedule).not.toHaveBeenCalled()
  })

  it('refuses a bad JSON body, an array, and a missing right', async () => {
    const post = await routes.scheduleCreate()
    expect((await post(new Request('http://test.local/_', { method: 'POST', body: '{nope' }))).status).toBe(400)
    expect((await call('scheduleCreate', { body: [] })).status).toBe(400)
    m.checkPermissions.mockResolvedValueOnce(denied())
    expect((await call('scheduleCreate', { body: SCHEDULE_BODY })).status).toBe(403)
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('scheduleCreate', { body: SCHEDULE_BODY })).status).toBe(403)
    expect(m.client.createRestoreDrillSchedule).not.toHaveBeenCalled()
  })

  it('409 when no PVE storage reaches the PBS, 404 for an unknown PBS', async () => {
    m.pveFetch.mockResolvedValueOnce([])
    let res = await call('scheduleCreate', { body: SCHEDULE_BODY })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'No PVE storage of this cluster points to this PBS datastore and namespace' })
    m.findUnique.mockResolvedValueOnce(null)
    res = await call('scheduleCreate', { body: SCHEDULE_BODY })
    expect(res.status).toBe(404)
  })

  it.each([400, 404, 409, 422])('relays the orchestrator %i with its message', async status => {
    m.client.createRestoreDrillSchedule.mockRejectedValueOnce(orchestratorError(status, { error: 'unsupported calendar expression' }))
    const res = await call('scheduleCreate', { body: SCHEDULE_BODY })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: 'unsupported calendar expression' })
    expect(m.audit).toHaveBeenCalledTimes(1)
    expect(m.audit.mock.calls[0][0]).toMatchObject({
      category: 'backups', action: 'create', resourceType: 'schedule', status: 'failure', errorMessage: 'unsupported calendar expression',
      details: expect.objectContaining({ method: 'POST', httpStatus: status }),
    })
  })

  it('503 when the orchestrator is down', async () => {
    const err: any = new Error('Orchestrator unavailable')
    err.code = 'ORCHESTRATOR_UNAVAILABLE'
    m.client.listRestoreDrillSchedules.mockRejectedValueOnce(err)
    expect((await call('schedulesList')).status).toBe(503)
  })

  it('reads one schedule with its runs and events', async () => {
    const res = await call('scheduleGet')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ schedule: SCHEDULE, runs: [RUN], events: [] })
    m.client.getRestoreDrillSchedule.mockResolvedValueOnce({ data: { schedule: SCHEDULE }, status: 200 })
    expect(await (await call('scheduleGet')).json()).toEqual({ schedule: SCHEDULE, runs: [], events: [] })
    expect((await call('scheduleGet', { params: { id: '../x' } })).status).toBe(404)
    m.client.getRestoreDrillSchedule.mockRejectedValueOnce(orchestratorError(404, { error: 'schedule not found' }))
    expect((await call('scheduleGet')).status).toBe(404)
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('scheduleGet')).status).toBe(403)
  })

  it('updates with the same rules, audited', async () => {
    const res = await call('scheduleUpdate', { method: 'PUT', body: { ...SCHEDULE_BODY, enabled: false } })
    expect(res.status).toBe(200)
    expect(m.client.updateRestoreDrillSchedule).toHaveBeenCalledWith(ID, expect.objectContaining({ enabled: false, created_by: 'admin@lab' }))
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resourceId: ID, resourceType: 'restore_drill_schedule' }))
    expect((await call('scheduleUpdate', { method: 'PUT', body: { ...SCHEDULE_BODY, vms_per_run: 99 } })).status).toBe(400)
    expect((await call('scheduleUpdate', { method: 'PUT', body: SCHEDULE_BODY, params: { id: 'a b' } })).status).toBe(404)
    const put = await routes.scheduleUpdate()
    expect((await put(new Request('http://test.local/_', { method: 'PUT', body: 'x' }), { params: Promise.resolve({ id: ID }) })).status).toBe(400)
    m.client.updateRestoreDrillSchedule.mockRejectedValueOnce(orchestratorError(404, { error: 'schedule not found' }))
    expect((await call('scheduleUpdate', { method: 'PUT', body: SCHEDULE_BODY })).status).toBe(404)
  })

  it('update is judged on the stored target too: a schedule cannot be taken over by moving it', async () => {
    m.checkPermissions.mockImplementation(async (_p: unknown, _t: unknown, id: string) => (id === 'conn-1:pve2' ? denied() : null))
    expect((await call('scheduleUpdate', { method: 'PUT', body: SCHEDULE_BODY })).status).toBe(403)
    expect(m.client.updateRestoreDrillSchedule).not.toHaveBeenCalled()
    m.checkPermissions.mockResolvedValue(null)
    m.client.getRestoreDrillSchedule.mockResolvedValueOnce({ data: {}, status: 200 })
    expect((await call('scheduleUpdate', { method: 'PUT', body: SCHEDULE_BODY })).status).toBe(404)
    expect(m.client.updateRestoreDrillSchedule).not.toHaveBeenCalled()
  })

  it.each([
    ['scheduleDelete', 'deleteRestoreDrillSchedule', 'delete', 204],
    ['scheduleRun', 'runRestoreDrillSchedule', 'test', 202],
  ] as const)('%s needs the creation rights on the stored schedule target and is audited', async (name, method, action, status) => {
    const res = await call(name, { method: METHODS[name] })
    expect(res.status).toBe(status)
    expect(m.checkPermissions).toHaveBeenCalledWith(['vm.backup', 'backup.restore'], 'node', 'conn-1:pve2')
    expect(m.checkPermission).toHaveBeenCalledWith('backup.view', 'pbs', 'pbs-1')
    expect(m.client[method]).toHaveBeenCalledWith(ID)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action, resourceId: ID, resourceType: 'restore_drill_schedule', resourceName: 'Nightly PBS check' }))
  })

  it('run answers the pass', async () => {
    expect(await (await call('scheduleRun', { method: 'POST' })).json()).toEqual({ run: RUN })
  })

  it('delete and run refuse without the right, for an unknown or malformed schedule', async () => {
    m.checkPermission.mockResolvedValueOnce(denied())
    expect((await call('scheduleDelete', { method: 'DELETE' })).status).toBe(403)
    expect(m.client.deleteRestoreDrillSchedule).not.toHaveBeenCalled()
    m.client.getRestoreDrillSchedule.mockResolvedValueOnce({ data: {}, status: 200 })
    expect((await call('scheduleRun', { method: 'POST' })).status).toBe(404)
    expect((await call('scheduleRun', { method: 'POST', params: { id: '../x' } })).status).toBe(404)
    m.client.getRestoreDrillSchedule.mockRejectedValueOnce(orchestratorError(404, { error: 'schedule not found' }))
    expect((await call('scheduleDelete', { method: 'DELETE' })).status).toBe(404)
    expect(m.client.runRestoreDrillSchedule).not.toHaveBeenCalled()
  })

  it('relays the orchestrator answer of a run or a delete', async () => {
    m.client.runRestoreDrillSchedule.mockRejectedValueOnce(orchestratorError(409, { error: 'previous pass still running' }))
    const res = await call('scheduleRun', { method: 'POST' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'previous pass still running' })
    m.client.deleteRestoreDrillSchedule.mockRejectedValueOnce(new Error('boom'))
    expect((await call('scheduleDelete', { method: 'DELETE' })).status).toBe(500)
  })
})
