import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const {
  userGuardMock, targetGuardMock, settingsMock, connMock, resolveSourceMock, pveFetchMock,
  createMock, findManyMock, auditMock, runMock, afterMock, checkPermissionMock, purgeMock, reconcileMock, hostGuardMock,
} = vi.hoisted(() => ({
  userGuardMock: vi.fn(),
  targetGuardMock: vi.fn(),
  settingsMock: vi.fn(),
  connMock: vi.fn(),
  resolveSourceMock: vi.fn(),
  pveFetchMock: vi.fn(),
  createMock: vi.fn(),
  findManyMock: vi.fn(),
  auditMock: vi.fn(),
  runMock: vi.fn(),
  afterMock: vi.fn((fn: () => unknown) => { void fn() }),
  checkPermissionMock: vi.fn(),
  purgeMock: vi.fn(),
  reconcileMock: vi.fn(),
  hostGuardMock: vi.fn(),
}))

vi.mock('next/server', async importOriginal => ({ ...(await importOriginal<typeof import('next/server')>()), after: (fn: () => unknown) => afterMock(fn) }))
vi.mock('@/lib/guestFileRestore/guard', () => ({
  requireGuestFileRestoreUser: () => userGuardMock(),
  authorizeRestoreTarget: (...a: any[]) => targetGuardMock(...a),
}))
vi.mock('@/lib/guestFileRestore/settings', () => ({ loadGuestFileRestoreSettings: () => settingsMock() }))
vi.mock('@/lib/guestFileRestore/guestAddresses', () => ({ assertSshHostAllowed: (...a: any[]) => hostGuardMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionByIdOrNull: (...a: any[]) => connMock(...a) }))
vi.mock('@/lib/guestFileRestore/sources', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/guestFileRestore/sources')>()),
  resolveGuestRestoreSource: (...a: any[]) => resolveSourceMock(...a),
}))
vi.mock('@/lib/guestFileRestore/runner', () => ({
  runGuestFileRestoreJob: (...a: any[]) => runMock(...a),
  knownBytesTotal: (items: any[]) => (items.length > 0 && items.every(i => !i.directory && typeof i.size === 'number')
    ? items.reduce((sum, i) => sum + i.size, 0)
    : null),
}))
vi.mock('@/lib/guestFileRestore/store', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/guestFileRestore/store')>()),
  purgeExpiredJobs: (...a: any[]) => purgeMock(...a),
  reconcileStaleJobs: (rows: any[]) => reconcileMock(rows),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: async () => 'default',
  getSessionPrisma: async () => ({ guestFileRestoreJob: { create: createMock, findMany: findManyMock } }),
}))

import { GET, POST } from './route'

const target = { connId: 'c1', node: 'pve1', type: 'qemu', vmid: 100 }
const source = { kind: 'pve', connId: 'c1', storage: 'pbs', volume: 'backup/vm/100/2026-09-20T18:51:49Z' }
const items = [{ path: '/drive-scsi0.img.fidx/part/1/etc/hosts', directory: false, size: 20 }]
const settings = {
  agentEnabled: true, sshEnabled: true, agentMaxBytes: 1024, defaultConflict: 'keep', restoredPrefix: 'RESTORED-',
  defaultCustomDirLinux: '/var/tmp/proxcenter-restore', defaultCustomDirWindows: 'C:\\ProxCenter-Restore',
  sshConnectTimeoutSec: 20, maxConcurrentJobs: 3, jobRetentionDays: 30,
}
const resolved = { kind: 'pve', conn: { id: 'c1', apiToken: 'secret' }, dispatcher: undefined, nodeName: 'pve1', storage: 'pbs', volumeId: 'pbs:backup/vm/100/x' }

function body(over: object = {}) {
  return { source, items, target, method: 'agent', destination: { mode: 'original' }, ...over }
}

beforeEach(() => {
  userGuardMock.mockReset().mockResolvedValue({ denied: null, principal: { kind: 'session', userId: 'u1', userEmail: 'alice@example.org', tenantId: 'default' } })
  targetGuardMock.mockReset().mockResolvedValue(null)
  settingsMock.mockReset().mockResolvedValue({ ...settings })
  connMock.mockReset().mockResolvedValue({ id: 'c1', baseUrl: 'https://pve:8006', apiToken: 't' })
  resolveSourceMock.mockReset().mockResolvedValue(resolved)
  pveFetchMock.mockReset().mockResolvedValue({ name: 'web-01' })
  createMock.mockReset().mockImplementation(async (args: any) => ({ id: 'job1', ...args.data }))
  findManyMock.mockReset().mockResolvedValue([])
  auditMock.mockReset().mockResolvedValue('a1')
  runMock.mockReset().mockResolvedValue(undefined)
  afterMock.mockClear()
  checkPermissionMock.mockReset().mockResolvedValue(null)
  purgeMock.mockReset().mockResolvedValue(0)
  reconcileMock.mockReset().mockImplementation(async (rows: any[]) => rows)
  hostGuardMock.mockReset().mockResolvedValue(null)
})

const FINGERPRINT = 'SHA256:' + 'a'.repeat(43)

describe('POST /api/v1/guest-file-restore/jobs', () => {
  it('creates the row, audits without credentials and starts the runner after the response', async () => {
    const ssh = { host: '10.0.0.5', username: 'root', password: 'hunter2', hostKeyFingerprint: FINGERPRINT }
    const res = await callRoute(POST, { body: body({ method: 'ssh', ssh, destination: { mode: 'custom', path: ' /restore ' } }) })
    expect(res.status).toBe(202)
    expect(await readJson(res)).toEqual({ data: { id: 'job1' } })

    const data = createMock.mock.calls[0][0].data
    expect(data).toMatchObject({
      connectionId: 'c1', node: 'pve1', vmid: 100, guestType: 'qemu', guestName: 'web-01', method: 'ssh',
      conflict: 'keep', status: 'queued', createdById: 'u1', createdByEmail: 'alice@example.org',
      destination: { mode: 'custom', path: '/restore' },
    })
    expect(data.bytesTotal).toBe(BigInt(20))
    expect(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))).not.toContain('hunter2')

    expect(auditMock).toHaveBeenCalledTimes(1)
    const entry = auditMock.mock.calls[0][0]
    expect(entry).toMatchObject({ action: 'restore', category: 'backups', resourceType: 'guest_file_restore_job', resourceId: 'job1', resourceName: 'web-01' })
    expect(entry.details).toMatchObject({ operation: 'restore_files_to_guest', phase: 'start', method: 'ssh', items: 1, source: 'pbs:backup/vm/100/2026-09-20T18:51:49Z' })
    expect(JSON.stringify(entry)).not.toContain('hunter2')

    expect(hostGuardMock).toHaveBeenCalledWith({ conn: expect.objectContaining({ id: 'c1' }), target, host: '10.0.0.5', principal: expect.objectContaining({ userId: 'u1' }) })
    expect(afterMock).toHaveBeenCalledTimes(1)
    expect(runMock).toHaveBeenCalledWith('job1', expect.objectContaining({
      source: resolved, method: 'ssh', ssh, conflict: 'keep', settings: expect.objectContaining({ maxConcurrentJobs: 3 }),
      target: expect.objectContaining({ node: 'pve1', vmid: 100, type: 'qemu' }),
    }))
  })

  it('leaves bytesTotal null when an item has no size and honours the requested conflict', async () => {
    await callRoute(POST, { body: body({ items: [{ path: '/root.pxar.didx/etc', directory: true }], conflict: 'overwrite' }) })
    const data = createMock.mock.calls[0][0].data
    expect(data.bytesTotal).toBeNull()
    expect(data.conflict).toBe('overwrite')
  })

  it('refuses the agent method on a container, and disabled methods', async () => {
    expect((await callRoute(POST, { body: body({ target: { ...target, type: 'lxc' } }) })).status).toBe(400)
    settingsMock.mockResolvedValue({ ...settings, agentEnabled: false })
    expect((await callRoute(POST, { body: body() })).status).toBe(403)
    settingsMock.mockResolvedValue({ ...settings, sshEnabled: false })
    expect((await callRoute(POST, { body: body({ method: 'ssh', ssh: { host: 'h', username: 'u', password: 'p', hostKeyFingerprint: FINGERPRINT } }) })).status).toBe(403)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('requires the host key fingerprint confirmed in the dialog for an SSH job', async () => {
    const res = await callRoute(POST, { body: body({ method: 'ssh', ssh: { host: '10.0.0.5', username: 'root', password: 'p' } }) })
    expect(res.status).toBe(400)
    expect(((await readJson(res)) as any).issues.some((i: any) => i.path === 'ssh.hostKeyFingerprint')).toBe(true)
    const bad = await callRoute(POST, { body: body({ method: 'ssh', ssh: { host: '10.0.0.5', username: 'root', password: 'p', hostKeyFingerprint: 'MD5:00' } }) })
    expect(bad.status).toBe(400)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('refuses an SSH host outside the guest addresses without creating anything', async () => {
    hostGuardMock.mockResolvedValue(new Response(JSON.stringify({ error: "SSH host must be one of the guest's addresses" }), { status: 400 }))
    const res = await callRoute(POST, { body: body({ method: 'ssh', ssh: { host: '10.9.9.9', username: 'root', password: 'p', hostKeyFingerprint: FINGERPRINT } }) })
    expect(res.status).toBe(400)
    expect(createMock).not.toHaveBeenCalled()
    expect(runMock).not.toHaveBeenCalled()
  })

  it('rejects path traversal in items before touching anything', async () => {
    const res = await callRoute(POST, { body: body({ items: [{ path: '/root.pxar.didx/../../etc', directory: true }] }) })
    expect(res.status).toBe(400)
    expect(targetGuardMock).not.toHaveBeenCalled()
  })

  it('propagates the target and source refusals', async () => {
    targetGuardMock.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await callRoute(POST, { body: body() })).status).toBe(403)
    targetGuardMock.mockResolvedValue(null)
    resolveSourceMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Backup not accessible' }), { status: 403 }))
    expect((await callRoute(POST, { body: body() })).status).toBe(403)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('answers 404 when the target connection is unknown', async () => {
    connMock.mockResolvedValue(null)
    expect((await callRoute(POST, { body: body() })).status).toBe(404)
  })
})

describe('GET /api/v1/guest-file-restore/jobs', () => {
  it('lists the tenant jobs of a guest, purging and reconciling on the way', async () => {
    const row = {
      id: 'job1', tenantId: 'default', connectionId: 'c1', node: 'pve1', vmid: 100, guestType: 'qemu', guestName: null,
      source, items, method: 'agent', destination: { mode: 'original' }, conflict: 'keep', status: 'completed', guestOs: 'linux',
      bytesDone: BigInt(20), bytesRead: BigInt(20), bytesTotal: BigInt(20), filesDone: 1, filesSkipped: 0, filesFailed: 0, currentPath: null, error: null,
      log: [], createdById: 'u1', createdByEmail: 'alice@example.org', createdAt: new Date('2026-10-09T10:00:00Z'),
      startedAt: new Date('2026-10-09T10:00:01Z'), completedAt: new Date('2026-10-09T10:00:02Z'), updatedAt: new Date('2026-10-09T10:00:02Z'),
    }
    findManyMock.mockResolvedValue([row])
    const res = await callRoute(GET, { method: 'GET', searchParams: { connId: 'c1', vmid: '100', limit: '5' } })
    expect(res.status).toBe(200)
    const json = (await readJson(res)) as any
    expect(json.data).toHaveLength(1)
    expect(json.data[0]).toMatchObject({ id: 'job1', bytesDone: 20, bytesTotal: 20, createdAt: '2026-10-09T10:00:00.000Z' })
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.view', 'connection', 'c1')
    expect(findManyMock).toHaveBeenCalledWith({ where: { connectionId: 'c1', vmid: 100 }, orderBy: { createdAt: 'desc' }, take: 5 })
    expect(purgeMock).toHaveBeenCalledWith('default', 30)
    expect(reconcileMock).toHaveBeenCalledWith([row])
  })

  it('requires a global BACKUP_VIEW without a connection filter', async () => {
    checkPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))
    const res = await callRoute(GET, { method: 'GET' })
    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.view')
  })
})
