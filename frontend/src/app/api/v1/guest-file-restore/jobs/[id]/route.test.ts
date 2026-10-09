import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NextResponse } from 'next/server'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { userGuardMock, findUniqueMock, checkPermissionMock, reconcileMock } = vi.hoisted(() => ({
  userGuardMock: vi.fn(),
  findUniqueMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  reconcileMock: vi.fn(),
}))

vi.mock('@/lib/guestFileRestore/guard', () => ({ requireGuestFileRestoreUser: () => userGuardMock() }))
vi.mock('@/lib/guestFileRestore/store', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/guestFileRestore/store')>()),
  reconcileStaleJobs: (rows: any[]) => reconcileMock(rows),
}))
vi.mock('@/lib/tenant', () => ({ getSessionPrisma: async () => ({ guestFileRestoreJob: { findUnique: findUniqueMock } }) }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
}))

import { GET } from './route'

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'job1', tenantId: 'default', connectionId: 'c1', node: 'pve1', vmid: 100, guestType: 'qemu', guestName: 'web',
    source: { kind: 'pve', connId: 'c1', storage: 'pbs', volume: 'v' }, items: [], method: 'agent', destination: { mode: 'original' },
    conflict: 'keep', status: 'running', guestOs: 'linux', bytesDone: BigInt(5), bytesRead: BigInt(5), bytesTotal: BigInt(10), filesDone: 1, filesSkipped: 0,
    filesFailed: 0, currentPath: '/etc/x', error: null, log: [],
    createdById: 'u1', createdByEmail: null, createdAt: new Date('2026-10-09T10:00:00Z'), startedAt: new Date('2026-10-09T10:00:01Z'),
    completedAt: null, updatedAt: new Date(), ...over,
  }
}

beforeEach(() => {
  userGuardMock.mockReset().mockResolvedValue({ denied: null, principal: { kind: 'session', userId: 'u1', tenantId: 'default' } })
  findUniqueMock.mockReset().mockResolvedValue(row())
  checkPermissionMock.mockReset().mockResolvedValue(null)
  reconcileMock.mockReset().mockImplementation(async (rows: any[]) => rows)
})

describe('GET /api/v1/guest-file-restore/jobs/[id]', () => {
  it('returns the reconciled job DTO', async () => {
    reconcileMock.mockImplementation(async (rows: any[]) => rows.map(r => ({ ...r, status: 'interrupted' })))
    const res = await callRoute(GET, { params: { id: 'job1' } })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).data).toMatchObject({ id: 'job1', status: 'interrupted' })
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { id: 'job1' } })
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.view', 'connection', 'c1')
  })

  it('returns the guard denial untouched', async () => {
    userGuardMock.mockResolvedValue({ denied: NextResponse.json({ error: 'nope' }, { status: 403 }) })
    const res = await callRoute(GET, { params: { id: 'job1' } })
    expect(res.status).toBe(403)
    expect(findUniqueMock).not.toHaveBeenCalled()
  })

  it('rejects a missing id', async () => {
    const res = await callRoute(GET, { params: { id: '' } })
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown job', async () => {
    findUniqueMock.mockResolvedValue(null)
    const res = await callRoute(GET, { params: { id: 'nope' } })
    expect(res.status).toBe(404)
  })

  it('returns the RBAC denial when the caller cannot view backups on the connection', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await callRoute(GET, { params: { id: 'job1' } })
    expect(res.status).toBe(403)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('maps a thrown error to 500 with its message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    findUniqueMock.mockRejectedValue(new Error('db down'))
    const res = await callRoute(GET, { params: { id: 'job1' } })
    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'db down' })
  })

  it('falls back to a generic message when the error has none', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    findUniqueMock.mockRejectedValue({})
    const res = await callRoute(GET, { params: { id: 'job1' } })
    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'Erreur serveur' })
  })
})
