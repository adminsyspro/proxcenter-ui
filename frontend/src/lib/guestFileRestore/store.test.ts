import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateMock, deleteManyMock } = vi.hoisted(() => ({
  updateMock: vi.fn(async (args: any) => args),
  deleteManyMock: vi.fn(async () => ({ count: 2 })),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: { guestFileRestoreJob: { update: updateMock, deleteMany: deleteManyMock } } }))

import { registerJob, resetRegistry } from './registry'
import { INTERRUPTED_MESSAGE, STALE_AFTER_MS, isStaleRow, purgeExpiredJobs, reconcileStaleJobs, toJobDto } from './store'

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'job1',
    tenantId: 'default',
    connectionId: 'c1',
    node: 'pve1',
    vmid: 100,
    guestType: 'qemu',
    guestName: 'web-01',
    source: { kind: 'pve', connId: 'c1', storage: 'pbs', volume: 'backup/vm/100/x' },
    items: [{ path: '/root.pxar.didx/etc/hosts', directory: false }],
    method: 'agent',
    destination: { mode: 'original' },
    conflict: 'keep',
    status: 'running',
    guestOs: 'linux',
    bytesDone: BigInt(123456789012),
    bytesRead: BigInt(123456789012),
    bytesTotal: null,
    filesDone: 1,
    filesSkipped: 0,
    filesFailed: 0,
    currentPath: '/etc/hosts',
    error: null,
    log: [{ at: '2026-10-09T10:00:00.000Z', level: 'info', msg: 'started' }],
    createdById: 'u1',
    createdByEmail: 'alice@example.org',
    createdAt: new Date('2026-10-09T10:00:00Z'),
    startedAt: new Date('2026-10-09T10:00:01Z'),
    completedAt: null,
    // Ten minutes ago: stale unless a test says otherwise.
    updatedAt: new Date(Date.now() - 10 * 60_000),
    ...over,
  } as any
}

beforeEach(() => {
  resetRegistry()
  updateMock.mockClear()
  deleteManyMock.mockClear()
})

describe('toJobDto', () => {
  it('converts BigInt and dates, keeps the JSON columns', () => {
    const dto = toJobDto(row({ bytesTotal: BigInt(5) }))
    expect(dto).toEqual({
      id: 'job1',
      status: 'running',
      method: 'agent',
      guestOs: 'linux',
      connectionId: 'c1',
      node: 'pve1',
      vmid: 100,
      guestType: 'qemu',
      guestName: 'web-01',
      source: { kind: 'pve', connId: 'c1', storage: 'pbs', volume: 'backup/vm/100/x' },
      items: [{ path: '/root.pxar.didx/etc/hosts', directory: false }],
      destination: { mode: 'original' },
      conflict: 'keep',
      bytesDone: 123456789012,
      bytesRead: 123456789012,
      bytesTotal: 5,
      filesDone: 1,
      filesSkipped: 0,
      filesFailed: 0,
      currentPath: '/etc/hosts',
      error: null,
      log: [{ at: '2026-10-09T10:00:00.000Z', level: 'info', msg: 'started' }],
      createdByEmail: 'alice@example.org',
      createdAt: '2026-10-09T10:00:00.000Z',
      startedAt: '2026-10-09T10:00:01.000Z',
      completedAt: null,
    })
    expect(JSON.stringify(dto)).not.toContain('tenantId')
  })
})

describe('stale detection', () => {
  const now = Date.now()

  it('flags a running row with no controller and no update for two minutes', () => {
    expect(isStaleRow(row(), now)).toBe(true)
    expect(isStaleRow(row({ updatedAt: new Date(now - STALE_AFTER_MS + 1000) }), now)).toBe(false)
    expect(isStaleRow(row({ status: 'completed' }), now)).toBe(false)
  })
  it('trusts a row whose job is registered in this process', () => {
    registerJob('job1')
    expect(isStaleRow(row(), now)).toBe(false)
  })
  it('persists the interruption and returns the amended row', async () => {
    const [out] = await reconcileStaleJobs([row()])
    expect(out).toMatchObject({ status: 'failed', error: INTERRUPTED_MESSAGE })
    expect(out.log.at(-1)).toMatchObject({ level: 'error', msg: INTERRUPTED_MESSAGE })
    expect(updateMock).toHaveBeenCalledWith({ where: { id: 'job1' }, data: expect.objectContaining({ status: 'failed', error: INTERRUPTED_MESSAGE }) })
  })
  it('leaves fresh and finished rows alone', async () => {
    const fresh = row({ updatedAt: new Date() })
    const done = row({ id: 'job2', status: 'completed' })
    expect(await reconcileStaleJobs([fresh, done])).toEqual([fresh, done])
    expect(updateMock).not.toHaveBeenCalled()
  })
})

describe('purgeExpiredJobs', () => {
  it('deletes only finished jobs of the tenant past the retention', async () => {
    const before = Date.now()
    expect(await purgeExpiredJobs('t1', 30)).toBe(2)
    const args = (deleteManyMock.mock.calls[0] as any)[0]
    expect(args.where.tenantId).toBe('t1')
    expect(args.where.status.in).toEqual(['completed', 'completed_with_errors', 'failed', 'cancelled'])
    expect(before - args.where.createdAt.lt.getTime()).toBeGreaterThanOrEqual(30 * 24 * 3600 * 1000 - 1000)
  })
})
