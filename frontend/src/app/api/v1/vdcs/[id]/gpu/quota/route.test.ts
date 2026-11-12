import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  perimeter: vi.fn(),
  getVdc: vi.fn(),
  load: vi.fn(),
  list: vi.fn(),
  replace: vi.fn(),
  lock: vi.fn(),
}))

vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/gpu/quotaGuard', () => ({ requireGpuQuotaAccess: async (...a: unknown[]) => (await m.access(...a)).denied }))
vi.mock('@/lib/api-tokens/routeGuard', () => ({ withPublicApiGuard: (_id: string, handler: unknown) => handler }))
vi.mock('@/lib/api-tokens/scope', () => ({ filterToTokenPerimeter: (...a: unknown[]) => m.perimeter(...a) }))
vi.mock('@/lib/vdc', () => ({ getVdcById: (...a: unknown[]) => m.getVdc(...a) }))
vi.mock('@/lib/gpu/vdcContext', () => ({ loadVdcGpuContext: (...a: unknown[]) => m.load(...a) }))
vi.mock('@/lib/gpu/vdcLock', () => ({ withVdcLock: (...a: unknown[]) => m.lock(...a) }))
vi.mock('@/lib/gpu/vdcEntries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/vdcEntries')>('@/lib/gpu/vdcEntries')
  return {
    ...actual,
    listVdcGpuEntries: (...a: unknown[]) => m.list(...a),
    replaceVdcGpuEntries: (...a: unknown[]) => m.replace(...a),
  }
})

import { GET, PUT } from './route'

const vdc = { id: 'vdc-1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'vdc-acme', enabled: true, name: 'Acme' }
const entry = { id: 'e1', kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', count: 2 }
const offers = [{ kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', fbMemory: 12288, freeNow: 3 }]
const capacity = [{ modelKey: '0x10de:0x2231', modelName: 'RTX A5000', fbTotal: 24576, wholeCards: 1, partial: false }]
const params = { id: 'vdc-1' }
const line = { kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', count: 2 }

const ctx = (entries: unknown[], usage: Array<[string, number]> = []) => ({
  report: { devices: [], allocations: [] },
  catalog: [],
  entries,
  usage: new Map(usage),
})

const body = (r: { json: () => Promise<unknown> }) => r.json() as Promise<any>

beforeEach(() => {
  vi.clearAllMocks()
  m.access.mockResolvedValue({ denied: null, userId: 'u1' })
  m.perimeter.mockReset().mockImplementation(async (items: unknown[]) => items)
  m.getVdc.mockResolvedValue(vdc)
  m.lock.mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn())
  m.list.mockResolvedValue([entry])
  m.replace.mockResolvedValue([entry])
  m.load.mockResolvedValue(ctx([entry], [['e1', 1]]))
})

vi.mock('@/lib/gpu/vdcQuota', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/vdcQuota')>('@/lib/gpu/vdcQuota')
  return { ...actual, quotaOffers: () => offers, quotaCapacity: () => capacity }
})

describe('GET /api/v1/vdcs/{id}/gpu/quota', () => {
  it('returns the denial of the settings guard untouched', async () => {
    const denied = new Response(JSON.stringify({ error: 'feature_required' }), { status: 403 })
    m.access.mockResolvedValue({ denied })
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(403)
    expect(m.getVdc).not.toHaveBeenCalled()
  })

  it('answers 404 not_found for an unknown vDC', async () => {
    m.getVdc.mockResolvedValue(null)
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: 'not_found' })
  })

  it('lists the lines with what they hold and the offers of the cluster', async () => {
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(200)
    expect(m.load).toHaveBeenCalledWith(expect.objectContaining({ id: 'vdc-1', pvePoolName: 'vdc-acme' }), { refresh: false })
    expect((await body(res)).data).toEqual({
      entries: [{ ...entry, held: 1, overCommitted: false }],
      offers,
      capacity,
      readable: true,
    })
  })

  it('adds up the card models of the cluster from the context already loaded', async () => {
    const res = await callRoute(GET, { params })
    expect((await body(res)).data.capacity).toEqual([
      { modelKey: '0x10de:0x2231', modelName: 'RTX A5000', fbTotal: 24576, wholeCards: 1, partial: false },
    ])
    expect(m.load).toHaveBeenCalledTimes(1)
  })

  it('works without any line: the provider sets the first contingent', async () => {
    m.load.mockResolvedValue(ctx([]))
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(200)
    expect((await body(res)).data).toEqual({ entries: [], offers, capacity, readable: true })
  })

  it('flags a line lowered under what the vDC holds', async () => {
    m.load.mockResolvedValue(ctx([entry], [['e1', 3]]))
    const res = await callRoute(GET, { params })
    expect((await body(res)).data.entries[0]).toMatchObject({ held: 3, count: 2, overCommitted: true })
  })

  it('answers with the stored lines and readable false when the cluster cannot be read', async () => {
    m.load.mockRejectedValue(new Error('PVE unreachable 10.0.0.1'))
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(200)
    const out = await body(res)
    expect(out.data).toEqual({ entries: [{ ...entry, held: 0, overCommitted: false }], offers: [], capacity: [], readable: false })
    expect(JSON.stringify(out)).not.toContain('10.0.0.1')
  })
})

describe('PUT /api/v1/vdcs/{id}/gpu/quota', () => {
  it('returns the denial of the settings guard untouched', async () => {
    m.access.mockResolvedValue({ denied: new Response('{}', { status: 404 }) })
    const res = await callRoute(PUT, { params, body: { entries: [line] } })
    expect(res.status).toBe(404)
    expect(m.replace).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown vDC', async () => {
    m.getVdc.mockResolvedValue(null)
    const res = await callRoute(PUT, { params, body: { entries: [line] } })
    expect(res.status).toBe(404)
    expect(m.replace).not.toHaveBeenCalled()
  })

  it.each([
    ['no entries key', {}],
    ['entries not an array', { entries: 'x' }],
    ['a bad model key', { entries: [{ ...line, modelKey: '0X10DE:2231' }] }],
    ['a count of zero', { entries: [{ ...line, count: 0 }] }],
    ['a duplicated line', { entries: [line, line] }],
  ])('refuses %s with invalid_body', async (_name, payload) => {
    const res = await callRoute(PUT, { params, body: payload as any })
    expect(res.status).toBe(400)
    expect(await body(res)).toEqual({ error: 'invalid_body' })
    expect(m.replace).not.toHaveBeenCalled()
  })

  it('refuses an unparsable body with invalid_body', async () => {
    const res = await callRoute(PUT, { params, body: undefined })
    expect(res.status).toBe(400)
    expect(m.replace).not.toHaveBeenCalled()
  })

  it('replaces the contingent under the lock of the vDC and answers with held', async () => {
    const res = await callRoute(PUT, { params, body: { entries: [line] } })
    expect(res.status).toBe(200)
    expect(m.lock).toHaveBeenCalledWith('vdc-1', expect.any(Function))
    expect(m.replace).toHaveBeenCalledWith('vdc-1', [line])
    expect(m.load).toHaveBeenCalledWith(expect.objectContaining({ id: 'vdc-1' }), { refresh: false })
    expect((await body(res)).data).toEqual({ entries: [{ ...entry, held: 1, overCommitted: false }], offers, capacity, readable: true })
  })

  it('flags a line reduced under what is held', async () => {
    m.load.mockResolvedValue(ctx([{ ...entry, count: 1 }], [['e1', 2]]))
    const res = await callRoute(PUT, { params, body: { entries: [{ ...line, count: 1 }] } })
    expect((await body(res)).data.entries[0]).toMatchObject({ count: 1, held: 2, overCommitted: true })
  })

  it('writes even when the cluster cannot be read, and says so', async () => {
    m.load.mockRejectedValue(new Error('boom'))
    const res = await callRoute(PUT, { params, body: { entries: [line] } })
    expect(res.status).toBe(200)
    expect(m.replace).toHaveBeenCalled()
    expect((await body(res)).data).toEqual({ entries: [{ ...entry, held: 0, overCommitted: false }], offers: [], capacity: [], readable: false })
  })

  it('clears the contingent with an empty list', async () => {
    m.replace.mockResolvedValue([])
    m.load.mockResolvedValue(ctx([]))
    const res = await callRoute(PUT, { params, body: { entries: [] } })
    expect(res.status).toBe(200)
    expect(m.replace).toHaveBeenCalledWith('vdc-1', [])
    expect((await body(res)).data.entries).toEqual([])
  })
})

describe('GPU quota for API tokens (issue #1360)', () => {
  it('reads with admin.settings.view and replaces with admin.settings.vdcs', async () => {
    await callRoute(GET, { params })
    expect(m.access).toHaveBeenLastCalledWith('admin.settings.view')
    await callRoute(PUT, { params, method: 'PUT', body: { entries: [line] } })
    expect(m.access).toHaveBeenLastCalledWith('admin.settings.vdcs')
  })

  it('answers 404 for a vDC outside the token perimeter, before any read or write', async () => {
    m.perimeter.mockResolvedValue([])
    expect((await callRoute(GET, { params })).status).toBe(404)
    expect((await callRoute(PUT, { params, method: 'PUT', body: { entries: [line] } })).status).toBe(404)
    expect(m.load).not.toHaveBeenCalled()
    expect(m.replace).not.toHaveBeenCalled()
  })
})
