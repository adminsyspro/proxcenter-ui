import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryRawMock = vi.fn()

vi.mock('@/lib/db/prisma', () => ({
  prisma: { $queryRaw: queryRawMock },
}))

const { GET } = await import('./route')

describe('GET /api/health', () => {
  beforeEach(() => {
    queryRawMock.mockReset()
  })

  it('returns ok with db reachable when query succeeds', async () => {
    queryRawMock.mockResolvedValue([{}])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.db).toBe('reachable')
  })

  it('returns ok with db unreachable when query fails', async () => {
    queryRawMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.db).toBe('unreachable')
  })

  it('always includes a timestamp', async () => {
    queryRawMock.mockResolvedValue([{}])
    const res = await GET()
    const body = await res.json()
    expect(body.timestamp).toBeDefined()
    expect(new Date(body.timestamp).getTime()).not.toBeNaN()
  })
})
