import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const queryRawMock = vi.fn()

vi.mock('@/lib/db/prisma', () => ({
  prisma: { $queryRaw: queryRawMock },
}))

const { GET } = await import('./route')

describe('GET /api/health (readiness)', () => {
  beforeEach(() => {
    queryRawMock.mockReset()
  })

  it('returns 200 healthy when the DB answers', async () => {
    queryRawMock.mockResolvedValue([{}])
    const res = await callRoute(GET as never, { url: 'http://test.local/api/health' })
    expect(res.status).toBe(200)
    const body = await readJson<Record<string, string>>(res)
    expect(body!.status).toBe('healthy')
    expect(body!.db).toBe('reachable')
  })

  it('returns 503 unhealthy when the DB is unreachable (pre-HA contract)', async () => {
    queryRawMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await callRoute(GET as never, { url: 'http://test.local/api/health' })
    expect(res.status).toBe(503)
    const body = await readJson<Record<string, string>>(res)
    expect(body!.status).toBe('unhealthy')
    expect(body!.db).toBe('unreachable')
  })

  it('?live=1 returns 200 without touching the DB, even when the DB is down', async () => {
    queryRawMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await callRoute(GET as never, {
      url: 'http://test.local/api/health',
      searchParams: { live: '1' },
    })
    expect(res.status).toBe(200)
    const body = await readJson<Record<string, string>>(res)
    expect(body!.status).toBe('alive')
    expect(queryRawMock).not.toHaveBeenCalled()
  })

  it('always includes a parseable timestamp', async () => {
    queryRawMock.mockResolvedValue([{}])
    const res = await callRoute(GET as never, { url: 'http://test.local/api/health' })
    const body = await readJson<Record<string, string>>(res)
    expect(new Date(body!.timestamp).getTime()).not.toBeNaN()
  })
})
