import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  access: { ok: true, prisma: {}, batch: { id: 'b1' } } as any,
  batchWithJobs: vi.fn(async (_p: unknown, batch: any) => ({ ...batch, jobs: [] })),
}))

vi.mock('@/lib/migration/batch-access', () => ({
  loadBatchForCaller: vi.fn(async () => h.access),
  batchWithJobs: h.batchWithJobs,
}))

import { GET } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

beforeEach(() => {
  h.access = { ok: true, prisma: {}, batch: { id: 'b1' } }
  h.batchWithJobs.mockClear()
})

describe('GET /api/v1/migrations/batches/[id]', () => {
  it('passes the lines each job already shows to the read', async () => {
    const body: any = await readJson(await callRoute(GET, { params: { id: 'b1' }, searchParams: { logsAfter: '4,0,12' } }))

    expect(body.data.id).toBe('b1')
    expect(h.batchWithJobs).toHaveBeenCalledWith({}, { id: 'b1' }, [4, 0, 12])
  })

  it('reads every log whole without counts, or with a malformed list', async () => {
    await callRoute(GET, { params: { id: 'b1' } })
    await callRoute(GET, { params: { id: 'b1' }, searchParams: { logsAfter: '4,abc' } })

    expect(h.batchWithJobs.mock.calls.map(c => (c as unknown[])[2])).toEqual([undefined, undefined])
  })

  it('answers what the access check answers', async () => {
    h.access = { ok: false, response: new Response('{}', { status: 404 }) }

    expect((await callRoute(GET, { params: { id: 'other' } })).status).toBe(404)
    expect(h.batchWithJobs).not.toHaveBeenCalled()
  })
})
