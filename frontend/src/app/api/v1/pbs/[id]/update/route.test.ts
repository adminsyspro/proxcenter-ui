/**
 * ui#1428: update of a Proxmox Backup Server through the orchestrator. These
 * tests pin what the routes send (address, options, the SSH credentials of
 * the connection) and what they refuse (no SSH, a run of another connection).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  checkPermission: vi.fn(),
  getPbsConnectionById: vi.fn(),
  getConnectionByIdOrNull: vi.fn(),
  orchestratorFetch: vi.fn(),
  pveFetch: vi.fn(),
  connectionFindUnique: vi.fn(),
  connectionFindMany: vi.fn(),
}))

vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => m.checkPermission(...a),
  PERMISSIONS: { NODE_MANAGE: 'node.manage', BACKUP_VIEW: 'backup.view' },
}))
vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionById: (...a: any[]) => m.getPbsConnectionById(...a),
  getConnectionByIdOrNull: (...a: any[]) => m.getConnectionByIdOrNull(...a),
}))
vi.mock('@/lib/orchestrator/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: any[]) => m.orchestratorFetch(...a),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => m.pveFetch(...a) }))
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: (v: string) => `plain:${v}` }))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findUnique: m.connectionFindUnique, findMany: m.connectionFindMany } }),
}))

import { POST as preflight } from './preflight/route'
import { DELETE, GET, POST } from './route'

const PBS = {
  name: 'PBS', type: 'pbs', baseUrl: 'https://10.42.0.201:8007', fingerprint: null,
  sshEnabled: true, sshPort: 2222, sshUser: 'proxcenter', sshAuthMethod: 'key', sshKeyEnc: 'KEY', sshPassEnc: 'PASS',
}
const params = { id: 'pbs-1' }
const lastOrchestratorCall = () => m.orchestratorFetch.mock.calls.at(-1) as [string, { method?: string, body?: any }]

beforeEach(() => {
  vi.clearAllMocks()
  m.checkPermission.mockResolvedValue(null)
  m.getPbsConnectionById.mockResolvedValue({ id: 'pbs-1', baseUrl: PBS.baseUrl })
  m.connectionFindUnique.mockResolvedValue(PBS)
  m.connectionFindMany.mockResolvedValue([])
  m.orchestratorFetch.mockResolvedValue({})
})

describe('POST /pbs/[id]/update', () => {
  it('starts the run with the address, the options and the decrypted SSH credentials', async () => {
    m.orchestratorFetch.mockResolvedValue({ id: 'run-1', kind: 'pbs', connection_id: 'pbs-1', config: { ssh_credentials: { sshKey: 'leak' }, auto_reboot: false } })

    const res = await callRoute(POST, { params, body: { autoReboot: false, rebootTimeout: 900, datastoreReadOnly: true } })

    expect(res.status).toBe(201)
    const [path, init] = lastOrchestratorCall()

    expect(path).toBe('/rolling-updates/pbs')
    expect(init.method).toBe('POST')
    expect(init.body.connection_id).toBe('pbs-1')
    expect(init.body.config).toMatchObject({
      auto_reboot: false,
      reboot_timeout: 900,
      pbs: { name: 'PBS', host: '10.42.0.201', datastore_read_only: true },
      ssh_credentials: { sshEnabled: true, sshPort: 2222, sshUser: 'proxcenter', sshAuthMethod: 'key', sshKey: 'plain:KEY', sshPassphrase: 'plain:PASS' },
    })
    // The credentials never come back to the browser.
    expect((await readJson<any>(res)).data.config.ssh_credentials).toBeUndefined()
  })

  it('sends the saved secret as a password for password authentication', async () => {
    m.connectionFindUnique.mockResolvedValue({ ...PBS, sshAuthMethod: 'password', sshKeyEnc: null })

    await callRoute(POST, { params, body: {} })

    const creds = lastOrchestratorCall()[1].body.config.ssh_credentials

    expect(creds.sshPassword).toBe('plain:PASS')
    expect(creds.sshKey).toBeUndefined()
    expect(creds.sshPassphrase).toBeUndefined()
  })

  it('refuses a server without SSH, before any call to the orchestrator', async () => {
    m.connectionFindUnique.mockResolvedValue({ ...PBS, sshEnabled: false })

    const res = await callRoute(POST, { params, body: {} })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).code).toBe('ssh_disabled')
    expect(m.orchestratorFetch).not.toHaveBeenCalled()
  })

  it('answers 404 for a connection that is not a backup server', async () => {
    m.connectionFindUnique.mockResolvedValue({ ...PBS, type: 'pve' })

    expect((await callRoute(POST, { params, body: {} })).status).toBe(404)
    expect(m.orchestratorFetch).not.toHaveBeenCalled()
  })

  it('requires the right to manage the server', async () => {
    m.checkPermission.mockResolvedValue(new Response('denied', { status: 403 }))

    expect((await callRoute(POST, { params, body: {} })).status).toBe(403)
    expect(m.checkPermission).toHaveBeenCalledWith('node.manage', 'pbs', 'pbs-1')
    expect(m.connectionFindUnique).not.toHaveBeenCalled()
  })

  it('passes the refusal of the orchestrator through', async () => {
    m.orchestratorFetch.mockRejectedValue(new Error('Orchestrator 400: {"error":"Failed to start the update: preflight check failed: 1 task(s) are running"}'))

    const res = await callRoute(POST, { params, body: {} })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toContain('1 task(s) are running')
  })

  it('answers 503 when the orchestrator is not there', async () => {
    m.orchestratorFetch.mockRejectedValue(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))

    expect((await callRoute(POST, { params, body: {} })).status).toBe(503)
  })
})

describe('GET /pbs/[id]/update', () => {
  it('returns the most recent backup server run of the connection', async () => {
    m.orchestratorFetch.mockResolvedValue([
      { id: 'old', kind: 'pbs', connection_id: 'pbs-1', created_at: '2026-11-22T10:00:00Z' },
      { id: 'new', kind: 'pbs', connection_id: 'pbs-1', created_at: '2026-11-23T10:00:00Z', config: { ssh_credentials: {} } },
      { id: 'cluster', connection_id: 'pbs-1', created_at: '2026-11-24T10:00:00Z' },
    ])

    const body = await readJson<any>(await callRoute(GET, { params }))

    expect(body.data).toMatchObject({ sshEnabled: true, orchestrator: true })
    expect(body.data.run.id).toBe('new')
    expect(body.data.run.config.ssh_credentials).toBeUndefined()
    expect(m.checkPermission).toHaveBeenCalledWith('backup.view', 'pbs', 'pbs-1')
  })

  it('says so when the orchestrator is not there, without failing the tab', async () => {
    m.orchestratorFetch.mockRejectedValue(new Error('down'))

    const res = await callRoute(GET, { params })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toEqual({ sshEnabled: true, orchestrator: false, run: null })
  })

  it('reads one run by id, and hides a run of another connection', async () => {
    m.orchestratorFetch.mockResolvedValue({ id: 'run-1', kind: 'pbs', connection_id: 'pbs-1' })
    expect((await readJson<any>(await callRoute(GET, { params, searchParams: { run: 'run-1' } }))).data.run.id).toBe('run-1')
    expect(lastOrchestratorCall()[0]).toBe('/rolling-updates/run-1')

    m.orchestratorFetch.mockResolvedValue({ id: 'run-2', kind: 'pbs', connection_id: 'other' })
    expect((await readJson<any>(await callRoute(GET, { params, searchParams: { run: 'run-2' } }))).data.run).toBeNull()

    m.orchestratorFetch.mockResolvedValue({ id: 'run-3', connection_id: 'pbs-1' })
    expect((await readJson<any>(await callRoute(GET, { params, searchParams: { run: 'run-3' } }))).data.run).toBeNull()
  })
})

describe('DELETE /pbs/[id]/update', () => {
  it('cancels the run of this server', async () => {
    m.orchestratorFetch.mockResolvedValue({ id: 'run-1', kind: 'pbs', connection_id: 'pbs-1' })

    const res = await callRoute(DELETE, { params, searchParams: { run: 'run-1' }, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(lastOrchestratorCall()).toEqual(['/rolling-updates/run-1/cancel', { method: 'POST' }])
  })

  it('refuses without a run, and for a run of another connection', async () => {
    expect((await callRoute(DELETE, { params, method: 'DELETE' })).status).toBe(400)

    m.orchestratorFetch.mockResolvedValue({ id: 'run-9', kind: 'pbs', connection_id: 'other' })
    expect((await callRoute(DELETE, { params, searchParams: { run: 'run-9' }, method: 'DELETE' })).status).toBe(404)
    expect(m.orchestratorFetch).toHaveBeenCalledTimes(1)
  })
})

describe('POST /pbs/[id]/update/preflight', () => {
  it('adds the Proxmox VE backup jobs that write to the server, soonest first', async () => {
    const now = Math.floor(Date.now() / 1000)

    m.orchestratorFetch.mockResolvedValue({ can_proceed: true, findings: [] })
    m.connectionFindMany.mockResolvedValue([{ id: 'pve-1', name: 'PVE-DR' }, { id: 'pve-2', name: 'PVE-DOWN' }])
    m.getConnectionByIdOrNull.mockImplementation(async (id: string) => (id === 'pve-1' ? { id } : null))
    m.pveFetch.mockImplementation(async (_conn: unknown, path: string) => (path === '/storage'
      ? [{ storage: 'pbs-main', type: 'pbs', server: '10.42.0.201' }, { storage: 'other-pbs', type: 'pbs', server: '10.0.0.9' }, { storage: 'local', type: 'dir' }]
      : [
          { id: 'late', storage: 'pbs-main', schedule: 'sun 01:00', 'next-run': now + 86400 },
          { id: 'soon', storage: 'pbs-main', schedule: '*:0/30', 'next-run': now + 600 },
          { id: 'off', storage: 'pbs-main', schedule: 'daily', enabled: 0, 'next-run': now + 60 },
          { id: 'elsewhere', storage: 'other-pbs', schedule: 'daily', 'next-run': now + 60 },
        ]))

    const body = await readJson<any>(await callRoute(preflight, { params, body: {} }))

    expect(body.data.can_proceed).toBe(true)
    expect(body.data.backup_jobs.map((j: any) => j.id)).toEqual(['soon', 'late'])
    expect(body.data.backup_jobs[0]).toMatchObject({ connectionName: 'PVE-DR', storage: 'pbs-main', schedule: '*:0/30' })
    expect(body.data.upcoming_backup_jobs.map((j: any) => j.id)).toEqual(['soon'])
    expect(lastOrchestratorCall()[0]).toBe('/rolling-updates/pbs/preflight')
  })

  it('still answers when a cluster does not', async () => {
    m.orchestratorFetch.mockResolvedValue({ can_proceed: true, findings: [] })
    m.connectionFindMany.mockResolvedValue([{ id: 'pve-1', name: 'PVE-DR' }])
    m.getConnectionByIdOrNull.mockResolvedValue({ id: 'pve-1' })
    m.pveFetch.mockRejectedValue(new Error('timeout'))

    const body = await readJson<any>(await callRoute(preflight, { params, body: {} }))

    expect(body.data.backup_jobs).toEqual([])
  })

  it('refuses a server without SSH and a caller without the right', async () => {
    m.connectionFindUnique.mockResolvedValue({ ...PBS, sshEnabled: false })
    expect((await callRoute(preflight, { params, body: {} })).status).toBe(400)

    m.checkPermission.mockResolvedValue(new Response('denied', { status: 403 }))
    expect((await callRoute(preflight, { params, body: {} })).status).toBe(403)
  })

  it('passes an SSH failure of the orchestrator through', async () => {
    m.orchestratorFetch.mockRejectedValue(new Error('Orchestrator 400: {"error":"Preflight check failed: SSH connection to PBS failed"}'))

    const res = await callRoute(preflight, { params, body: {} })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toContain('SSH connection to PBS failed')
  })
})
