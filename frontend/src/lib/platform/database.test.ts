import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRawMock } = vi.hoisted(() => ({ queryRawMock: vi.fn() }))

vi.mock('@/lib/db/prisma', () => ({ prisma: { $queryRaw: (...a: any[]) => queryRawMock(...a) } }))

import { cacheHitPercent, readDatabase, toTable } from './database'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cacheHitPercent', () => {
  it('is the share of reads served from the cache', () => {
    expect(cacheHitPercent(995, 5)).toBe(99.5)
    expect(cacheHitPercent(0, 10)).toBe(0)
  })

  it('is null before any read', () => {
    expect(cacheHitPercent(0, 0)).toBeNull()
  })
})

describe('toTable', () => {
  it('keeps a never-analysed table without a row estimate', () => {
    expect(toTable({ name: 't', total_bytes: 8192, rows: -1, dead_rows: 0, last_vacuum: null })).toEqual({
      name: 't',
      totalBytes: 8192,
      rows: null,
      deadRows: 0,
      lastVacuum: null
    })
  })

  it('dates the last vacuum', () => {
    const at = new Date('2026-11-17T06:29:06.000Z')

    expect(toTable({ name: 't', total_bytes: 1, rows: 12, dead_rows: 3, last_vacuum: at })).toMatchObject({
      rows: 12,
      deadRows: 3,
      lastVacuum: '2026-11-17T06:29:06.000Z'
    })
  })
})

describe('readDatabase', () => {
  it('assembles the server figures and the tables', async () => {
    queryRawMock
      .mockResolvedValueOnce([
        {
          version: '16.15',
          started_at: new Date('2026-11-16T17:25:14.000Z'),
          size_bytes: 84294679,
          max_connections: 100,
          in_recovery: false,
          connections: 4,
          active: 2,
          blks_hit: 900,
          blks_read: 100,
          deadlocks: 1
        }
      ])
      .mockResolvedValueOnce([{ name: 'notifications', total_bytes: 26214400, rows: 36793, dead_rows: 1, last_vacuum: null }])

    expect(await readDatabase()).toEqual({
      version: '16.15',
      startedAt: '2026-11-16T17:25:14.000Z',
      sizeBytes: 84294679,
      connections: 4,
      activeConnections: 2,
      maxConnections: 100,
      cacheHitPercent: 90,
      deadlocks: 1,
      inRecovery: false,
      tables: [{ name: 'notifications', totalBytes: 26214400, rows: 36793, deadRows: 1, lastVacuum: null }]
    })
  })

  it('tolerates a server that does not date its start', async () => {
    queryRawMock
      .mockResolvedValueOnce([
        { version: '16', started_at: null, size_bytes: 1, max_connections: 10, in_recovery: true, connections: 1, active: 0, blks_hit: 0, blks_read: 0, deadlocks: 0 }
      ])
      .mockResolvedValueOnce([])

    expect(await readDatabase()).toMatchObject({ startedAt: null, cacheHitPercent: null, inRecovery: true, tables: [] })
  })

  it('lets a database failure through to the caller', async () => {
    queryRawMock.mockRejectedValue(new Error('connection refused'))
    await expect(readDatabase()).rejects.toThrow('connection refused')
  })
})
