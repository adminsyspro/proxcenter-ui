import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { userGuardMock, findUniqueMock, updateMock, cancelMock, checkPermissionMock } = vi.hoisted(() => ({
  userGuardMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  cancelMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock('@/lib/guestFileRestore/guard', () => ({ requireGuestFileRestoreUser: () => userGuardMock() }))
vi.mock('@/lib/guestFileRestore/runner', () => ({ cancelGuestFileRestoreJob: (...a: any[]) => cancelMock(...a) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { guestFileRestoreJob: { update: updateMock } } }))
vi.mock('@/lib/tenant', () => ({ getSessionPrisma: async () => ({ guestFileRestoreJob: { findUnique: findUniqueMock } }) }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { BACKUP_RESTORE: 'backup.restore' },
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
}))

import { POST } from './route'

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'job1', tenantId: 'default', connectionId: 'c1', node: 'pve1', vmid: 100, guestType: 'qemu', guestName: null,
    source: { kind: 'pve', connId: 'c1', storage: 'pbs', volume: 'v' }, items: [], method: 'agent', destination: { mode: 'original' },
    conflict: 'keep', status: 'running', guestOs: 'linux', bytesDone: BigInt(1), bytesRead: BigInt(1), bytesTotal: null, filesDone: 0, filesSkipped: 0,
    filesFailed: 0, currentPath: '/etc/x', error: null, log: [{ at: '2026-10-09T10:00:00.000Z', level: 'info', msg: 'started' }],
    createdById: 'u1', createdByEmail: null, createdAt: new Date('2026-10-09T10:00:00Z'), startedAt: new Date('2026-10-09T10:00:01Z'),
    completedAt: null, updatedAt: new Date(), ...over,
  }
}

beforeEach(() => {
  userGuardMock.mockReset().mockResolvedValue({ denied: null, principal: { kind: 'session', userId: 'u1', tenantId: 'default' } })
  findUniqueMock.mockReset().mockResolvedValue(row())
  updateMock.mockReset().mockImplementation(async (args: any) => ({ ...row(), ...args.data }))
  cancelMock.mockReset().mockReturnValue(true)
  checkPermissionMock.mockReset().mockResolvedValue(null)
})

describe('POST /api/v1/guest-file-restore/jobs/[id]/cancel', () => {
  it('aborts a job running in this process and leaves the final row to the runner', async () => {
    const res = await callRoute(POST, { params: { id: 'job1' }, method: 'POST' })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).data).toMatchObject({ id: 'job1', status: 'running' })
    expect(cancelMock).toHaveBeenCalledWith('job1')
    expect(updateMock).not.toHaveBeenCalled()
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.restore', 'vm', 'c1:pve1:qemu:100')
  })

  it('closes an orphaned row itself when no runner holds the job', async () => {
    cancelMock.mockReturnValue(false)
    const res = await callRoute(POST, { params: { id: 'job1' }, method: 'POST' })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).data).toMatchObject({ status: 'cancelled', currentPath: null })
    const data = updateMock.mock.calls[0][0].data
    expect(data.status).toBe('cancelled')
    expect(data.log.at(-1)).toMatchObject({ level: 'warn', msg: 'Cancelled by the operator' })
  })

  it('refuses to cancel a finished job', async () => {
    findUniqueMock.mockResolvedValue(row({ status: 'completed' }))
    const res = await callRoute(POST, { params: { id: 'job1' }, method: 'POST' })
    expect(res.status).toBe(400)
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown (or other-tenant) job and propagates RBAC refusals', async () => {
    findUniqueMock.mockResolvedValue(null)
    expect((await callRoute(POST, { params: { id: 'nope' }, method: 'POST' })).status).toBe(404)
    findUniqueMock.mockResolvedValue(row())
    checkPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await callRoute(POST, { params: { id: 'job1' }, method: 'POST' })).status).toBe(403)
    expect(cancelMock).not.toHaveBeenCalled()
  })
})
