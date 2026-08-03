import { describe, it, expect, vi, afterEach } from 'vitest'

const { createMock, findUniqueMock, findManyMock, countMock, updateManyMock, deleteManyMock } =
  vi.hoisted(() => ({
    createMock: vi.fn(),
    findUniqueMock: vi.fn(),
    findManyMock: vi.fn(),
    countMock: vi.fn(),
    updateManyMock: vi.fn(),
    deleteManyMock: vi.fn(),
  }))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    session: {
      create: createMock,
      findUnique: findUniqueMock,
      findMany: findManyMock,
      count: countMock,
      updateMany: updateManyMock,
      deleteMany: deleteManyMock,
    },
  },
}))

import {
  evaluateSession,
  createSession,
  touchSession,
  revokeSession,
  revokeAllSessions,
  purgeDeadSessions,
  countActiveSessions,
  TOUCH_THROTTLE_MS,
  type SessionRow,
} from './sessions'

afterEach(() => {
  vi.clearAllMocks()
})

const NOW = new Date('2026-08-03T12:00:00.000Z')
const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: 'sid1',
  userId: 'u1',
  createdAt: new Date('2026-08-03T11:00:00.000Z'),
  lastSeenAt: new Date('2026-08-03T11:59:00.000Z'),
  revokedAt: null,
  ipAddress: '10.0.0.1',
  userAgent: 'UA',
  ...over,
})

describe('evaluateSession is pure and names why a session is dead', () => {
  it('accepts a fresh session', () => {
    expect(evaluateSession(row(), NOW)).toEqual({ alive: true })
  })

  it('rejects a missing row', () => {
    expect(evaluateSession(null, NOW)).toEqual({ alive: false, reason: 'missing' })
    expect(evaluateSession(undefined, NOW)).toEqual({ alive: false, reason: 'missing' })
  })

  it('rejects a revoked row', () => {
    const r = row({ revokedAt: new Date('2026-08-03T11:30:00.000Z') })
    expect(evaluateSession(r, NOW)).toEqual({ alive: false, reason: 'revoked' })
  })

  it('rejects an idle session', () => {
    const r = row({ lastSeenAt: new Date('2026-08-02T23:00:00.000Z') })
    expect(evaluateSession(r, NOW)).toEqual({ alive: false, reason: 'idle' })
  })

  it('rejects a session past the absolute cap even when it is active right now', () => {
    const r = row({
      createdAt: new Date('2026-07-20T12:00:00.000Z'),
      lastSeenAt: new Date('2026-08-03T11:59:59.000Z'),
    })
    expect(evaluateSession(r, NOW)).toEqual({ alive: false, reason: 'absolute' })
  })

  it('reports revoked before idle when both apply', () => {
    const r = row({
      revokedAt: new Date('2026-08-01T00:00:00.000Z'),
      lastSeenAt: new Date('2026-08-01T00:00:00.000Z'),
    })
    expect(evaluateSession(r, NOW)).toEqual({ alive: false, reason: 'revoked' })
  })
})

describe('createSession', () => {
  it('mints a 32-char id and stores both timestamps', async () => {
    createMock.mockResolvedValue({})
    const sid = await createSession({ userId: 'u1', ipAddress: '1.2.3.4', userAgent: 'UA' })
    expect(sid).toHaveLength(32)
    const arg = createMock.mock.calls[0][0]
    expect(arg.data.id).toBe(sid)
    expect(arg.data.userId).toBe('u1')
    expect(arg.data.createdAt).toBeInstanceOf(Date)
    expect(arg.data.lastSeenAt).toBeInstanceOf(Date)
    expect(arg.data.revokedAt).toBeUndefined()
  })

  it('truncates an oversized user-agent instead of storing it whole', async () => {
    createMock.mockResolvedValue({})
    await createSession({ userId: 'u1', userAgent: 'x'.repeat(1000) })
    expect(createMock.mock.calls[0][0].data.userAgent).toHaveLength(255)
  })

  it('accepts a null ip and user-agent', async () => {
    createMock.mockResolvedValue({})
    await createSession({ userId: 'u1' })
    const d = createMock.mock.calls[0][0].data
    expect(d.ipAddress).toBeNull()
    expect(d.userAgent).toBeNull()
  })
})

describe('touchSession is throttled so one API call is not one write', () => {
  it('does not write when lastSeenAt is younger than the throttle', async () => {
    await touchSession('sid1', NOW, row({ lastSeenAt: new Date(NOW.getTime() - 1000) }))
    expect(updateManyMock).not.toHaveBeenCalled()
  })

  it('writes when lastSeenAt is older than the throttle', async () => {
    updateManyMock.mockResolvedValue({ count: 1 })
    await touchSession('sid1', NOW, row({ lastSeenAt: new Date(NOW.getTime() - TOUCH_THROTTLE_MS - 1) }))
    expect(updateManyMock).toHaveBeenCalledOnce()
    const arg = updateManyMock.mock.calls[0][0]
    expect(arg.where.id).toBe('sid1')
    // Scoped to a live row so a touch racing a revoke cannot resurrect it.
    expect(arg.where.revokedAt).toBeNull()
  })
})

describe('revocation', () => {
  it('revokeSession is scoped to the owner and reports whether it hit', async () => {
    updateManyMock.mockResolvedValue({ count: 1 })
    await expect(revokeSession('sid1', 'u1')).resolves.toBe(true)
    expect(updateManyMock.mock.calls[0][0].where).toMatchObject({
      id: 'sid1', userId: 'u1', revokedAt: null,
    })
  })

  it('revokeSession returns false when nothing matched (someone else\'s sid)', async () => {
    updateManyMock.mockResolvedValue({ count: 0 })
    await expect(revokeSession('sid-other', 'u1')).resolves.toBe(false)
  })

  it('revokeAllSessions can spare the current session', async () => {
    updateManyMock.mockResolvedValue({ count: 3 })
    await expect(revokeAllSessions('u1', 'sid-current')).resolves.toBe(3)
    expect(updateManyMock.mock.calls[0][0].where).toMatchObject({
      userId: 'u1', revokedAt: null, id: { not: 'sid-current' },
    })
  })

  it('revokeAllSessions with no exception revokes every live row', async () => {
    updateManyMock.mockResolvedValue({ count: 4 })
    await revokeAllSessions('u1')
    const where = updateManyMock.mock.calls[0][0].where
    expect(where).toMatchObject({ userId: 'u1', revokedAt: null })
    expect(where.id).toBeUndefined()
  })
})

describe('countActiveSessions counts only live rows', () => {
  it('excludes revoked, idle and over-cap rows', async () => {
    countMock.mockResolvedValue(2)
    await expect(countActiveSessions('u1')).resolves.toBe(2)
    const where = countMock.mock.calls[0][0].where
    expect(where.userId).toBe('u1')
    expect(where.revokedAt).toBeNull()
    expect(where.lastSeenAt).toHaveProperty('gt')
    expect(where.createdAt).toHaveProperty('gt')
  })
})

describe('purgeDeadSessions', () => {
  it('deletes revoked OR idle OR over-cap rows and returns the count', async () => {
    deleteManyMock.mockResolvedValue({ count: 7 })
    await expect(purgeDeadSessions(NOW)).resolves.toBe(7)
    const where = deleteManyMock.mock.calls[0][0].where
    expect(where.OR).toHaveLength(3)
  })
})
