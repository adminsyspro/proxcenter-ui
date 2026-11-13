// /api/v1/alerts and /api/v1/alerts/batch act only on the rows the caller
// sees, the acknowledger is the session's, and a purge takes a whole number
// of days, 1 or more (roadmap#223).
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  filter: vi.fn(),
  visibleIds: vi.fn(),
  acknowledger: vi.fn(),
  refuse: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    alert: {
      findMany: (...a: unknown[]) => m.findMany(...a),
      groupBy: (...a: unknown[]) => m.groupBy(...a),
      updateMany: (...a: unknown[]) => m.updateMany(...a),
      deleteMany: (...a: unknown[]) => m.deleteMany(...a),
    },
  }),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: async () => null,
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage' },
}))
vi.mock('@/lib/alerts/localAlertScope', () => ({
  localAlertFilter: (...a: unknown[]) => m.filter(...a),
  visibleLocalAlertIds: (...a: unknown[]) => m.visibleIds(...a),
  LOCAL_ALERT_ENTITY_SELECT: { id: true, entityId: true },
  refuseRestrictedAlertWrite: () => m.refuse(),
}))
vi.mock('@/lib/alerts/acknowledgedBy', () => ({ sessionAcknowledger: (...a: unknown[]) => m.acknowledger(...a) }))

import { DELETE, GET, PATCH, POST } from './route'
import { POST as SYNC } from './sync/route'
import { DELETE as BATCH_DELETE } from './batch/route'

const row = (id: string, entityId: string, status = 'active', severity = 'warn') => ({
  id, fingerprint: id, severity, message: id, source: 'PVE-PROD', sourceType: 'pve', entityType: 'node', entityId,
  entityName: entityId, metric: null, currentValue: null, threshold: null, status, acknowledgedAt: null,
  acknowledgedBy: null, resolvedAt: null, firstSeenAt: new Date(0), lastSeenAt: new Date(0), occurrences: 1,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.filter.mockResolvedValue(null)
  m.visibleIds.mockImplementation(async (ids: string[]) => ids)
  m.acknowledger.mockResolvedValue('Ops')
  m.updateMany.mockResolvedValue({ count: 1 })
  m.deleteMany.mockResolvedValue({ count: 1 })
  m.groupBy.mockResolvedValue([])
  m.refuse.mockResolvedValue(null)
})

describe('GET /api/v1/alerts', () => {
  it('lists the table as before for a caller nothing restricts', async () => {
    m.findMany.mockResolvedValue([row('a', 'pve1')])
    m.groupBy.mockResolvedValue([{ status: 'active', severity: 'warn', _count: 4 }])
    const json: any = await readJson(await callRoute(GET, { url: 'http://test.local/api/v1/alerts?status=active' }))
    expect(m.filter).toHaveBeenCalledWith('alerts.view')
    expect(m.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ where: { status: 'active' }, take: 100 }))
    expect(json.data.map((a: any) => a.id)).toEqual(['a'])
    expect(json.stats.active).toBe(4)
  })

  it("lists and counts only the rows a scoped caller sees", async () => {
    m.filter.mockResolvedValue((a: { entityId: string }) => a.entityId === 'pve1')
    m.findMany.mockResolvedValue([row('a', 'pve1'), row('b', 'pve2'), row('c', 'pve1', 'resolved'), row('d', 'pve1', 'active', 'crit')])
    const json: any = await readJson(await callRoute(GET, { url: 'http://test.local/api/v1/alerts?status=active&limit=1' }))
    expect(m.groupBy).not.toHaveBeenCalled()
    // Same order as the query's: crit before warn.
    expect(json.data.map((a: any) => a.id)).toEqual(['d'])
    expect(json.stats).toEqual({ total: 1, active: 2, acknowledged: 0, resolved: 1, bySeverity: { crit: 1, warn: 1, info: 0 } })
  })
})

describe('PATCH /api/v1/alerts', () => {
  it('acts on the visible ids only, acknowledged by the session', async () => {
    m.visibleIds.mockResolvedValue(['a'])
    const res = await callRoute(PATCH, { method: 'PATCH', body: { ids: ['a', 'b'], action: 'acknowledge', userId: 'ceo@corp' } })
    expect(res.status).toBe(200)
    expect(m.visibleIds.mock.calls[0].slice(0, 2)).toEqual([['a', 'b'], 'alerts.manage'])
    expect(m.acknowledger).toHaveBeenCalledWith('ceo@corp')
    expect(m.updateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['a'] } },
      data: expect.objectContaining({ status: 'acknowledged', acknowledgedBy: 'Ops' }),
    })
  })

  it('writes nothing when no id is visible', async () => {
    m.visibleIds.mockResolvedValue([])
    const res = await callRoute(PATCH, { method: 'PATCH', body: { ids: ['b'], action: 'resolve' } })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).data.updated).toBe(0)
    expect(m.updateMany).not.toHaveBeenCalled()
  })

  it('refuses more than 500 ids', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `a${i}`)
    expect((await callRoute(PATCH, { method: 'PATCH', body: { ids, action: 'resolve' } })).status).toBe(400)
    expect(m.updateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/alerts (purge)', () => {
  it.each(['-5', '0', '1.5', 'abc', '99999'])('refuses olderThanDays=%s', async raw => {
    const res = await callRoute(DELETE, { method: 'DELETE', url: `http://test.local/api/v1/alerts?olderThanDays=${raw}` })
    expect(res.status).toBe(400)
    expect(m.deleteMany).not.toHaveBeenCalled()
  })

  it('purges the resolved rows older than the cutoff as before for a caller nothing restricts', async () => {
    const res = await callRoute(DELETE, { method: 'DELETE', url: 'http://test.local/api/v1/alerts?olderThanDays=7' })
    expect(res.status).toBe(200)
    expect(m.deleteMany.mock.calls[0][0].where).toEqual({ status: 'resolved', resolvedAt: { lt: expect.any(Date) } })
  })

  it('defaults to 30 days', async () => {
    const before = Date.now()
    await callRoute(DELETE, { method: 'DELETE', url: 'http://test.local/api/v1/alerts' })
    const cutoff: Date = m.deleteMany.mock.calls[0][0].where.resolvedAt.lt
    expect(Math.round((before - cutoff.getTime()) / 86_400_000)).toBe(30)
  })

  it('purges only the rows a scoped caller sees', async () => {
    m.filter.mockResolvedValue((a: { entityId: string }) => a.entityId === 'pve1')
    m.findMany.mockResolvedValue([row('a', 'pve1', 'resolved'), row('b', 'pve2', 'resolved')])
    const res = await callRoute(DELETE, { method: 'DELETE', url: 'http://test.local/api/v1/alerts?olderThanDays=7' })
    expect(res.status).toBe(200)
    expect(m.findMany.mock.calls[0][0].where).toEqual({ status: 'resolved', resolvedAt: { lt: expect.any(Date) } })
    expect(m.deleteMany.mock.calls[0][0].where).toEqual({ id: { in: ['a'] } })
  })
})

describe('DELETE /api/v1/alerts/batch', () => {
  it('deletes the visible ids only', async () => {
    m.visibleIds.mockResolvedValue(['a'])
    const res = await callRoute(BATCH_DELETE, { method: 'DELETE', body: { ids: ['a', 'b'] } })
    expect(res.status).toBe(200)
    expect(m.visibleIds.mock.calls[0].slice(0, 2)).toEqual([['a', 'b'], 'alerts.manage'])
    expect(m.deleteMany.mock.calls[0][0]).toEqual({ where: { id: { in: ['a'] } } })
  })

  it.each([
    ['no ids', {}],
    ['an empty list', { ids: [] }],
    ['a non-string id', { ids: [{ in: ['x'] }] }],
    ['more than 500 ids', { ids: Array.from({ length: 501 }, (_, i) => `a${i}`) }],
  ])('refuses %s', async (_label, body) => {
    const res = await callRoute(BATCH_DELETE, { method: 'DELETE', body })
    expect(res.status).toBe(400)
    expect(m.deleteMany).not.toHaveBeenCalled()
  })

  it('deletes nothing when no id is visible', async () => {
    m.visibleIds.mockResolvedValue([])
    const res = await callRoute(BATCH_DELETE, { method: 'DELETE', body: { ids: ['b'] } })
    expect(((await readJson(res)) as any).data.deleted).toBe(0)
    expect(m.deleteMany).not.toHaveBeenCalled()
  })
})

describe('table-wide writes (POST /api/v1/alerts, POST /api/v1/alerts/sync)', () => {
  const refused = () => new Response(JSON.stringify({ error: 'This write needs alerts.manage on the whole tenant' }), { status: 403 })

  it('refuses a scoped caller before reading the body or writing', async () => {
    m.refuse.mockResolvedValue(refused())
    const body = { severity: 'warn', message: 'x', source: 'PVE', entityType: 'node', entityId: 'pve2' }
    expect((await callRoute(POST, { body })).status).toBe(403)
    expect((await callRoute(SYNC, { body: { alerts: [] } })).status).toBe(403)
    expect(m.updateMany).not.toHaveBeenCalled()
  })
})
