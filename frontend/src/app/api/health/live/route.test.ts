import { describe, it, expect } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// No prisma mock on purpose: the liveness route must not import the DB at all.
const { GET } = await import('./route')

describe('GET /api/health/live (liveness)', () => {
  it('always returns 200 alive', async () => {
    const res = await callRoute(GET as never, { url: 'http://test.local/api/health/live' })
    expect(res.status).toBe(200)
    const body = await readJson<Record<string, string>>(res)
    expect(body!.status).toBe('alive')
    expect(new Date(body!.timestamp).getTime()).not.toBeNaN()
  })
})
