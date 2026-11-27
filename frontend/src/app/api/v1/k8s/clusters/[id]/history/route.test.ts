import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const gateMock = vi.fn()
const historyMock = vi.fn()
const findManyMock = vi.fn()
const checkPermissionMock = vi.fn()
vi.mock('@/lib/k8s/requireK8sViewCluster', () => ({ requireK8sViewCluster: (...a: any[]) => gateMock(...a) }))
vi.mock('@/lib/k8s/orchestrator', () => ({ readHistory: (...a: any[]) => historyMock(...a) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { auditLog: { findMany: (...a: any[]) => findManyMock(...a) } } }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { ADMIN_AUDIT: 'admin.audit' }, checkPermission: (...a: any[]) => checkPermissionMock(...a) }))

const params = { id: 'c1' }
const auditRow = { timestamp: new Date('2026-11-27T10:00:00Z'), action: 'scale', status: 'success', resourceType: 'kubernetesWorkload', resourceId: 'c1/shop/deployment/web', resourceName: 'web', userEmail: 'ops@lab', details: { replicas: 2 } }
const event = { source: 'event', at: '2026-11-27T09:00:00Z', kind: 'pod', namespace: 'shop', name: 'web-1', type: 'Normal', reason: 'Pulled', message: 'ok', count: 1 }

beforeEach(() => {
  gateMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1', cluster: { credentialVersion: 3 }, credential: {} })
  historyMock.mockReset().mockResolvedValue({ ok: true, value: { entries: [event], partial: false } })
  findManyMock.mockReset().mockResolvedValue([auditRow])
  checkPermissionMock.mockReset().mockResolvedValue(null)
})

const get = async (searchParams: Record<string, string> = {}) => callRoute((await import('./route')).GET, { params, searchParams })

describe('GET history', () => {
  it('returns the gate response without reading anything', async () => {
    gateMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    expect((await get()).status).toBe(403)
    expect(historyMock).not.toHaveBeenCalled()
    expect(findManyMock).not.toHaveBeenCalled()
  })
  it('merges cluster history and the actions of this cluster, newest first', async () => {
    const body: any = await readJson(await get())
    expect(body.entries.map((e: any) => [e.source, e.name, e.user])).toEqual([['action', 'web', 'ops@lab'], ['event', 'web-1', undefined]])
    const where = findManyMock.mock.calls[0][0].where
    expect(where).toMatchObject({ tenantId: 't1', category: 'k8s', OR: [{ resourceId: 'c1' }, { resourceId: { startsWith: 'c1/' } }] })
    expect(where.action.in).not.toContain('logs')
  })
  it('hides who acted from a caller who cannot read the audit log', async () => {
    checkPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const body: any = await readJson(await get())
    expect(body.entries[0].user).toBeUndefined()
  })
  it('passes a namespace through and refuses an invalid one', async () => {
    await get({ namespace: 'shop' })
    expect(historyMock).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'shop', credentialVersion: 3 }))
    expect((await get({ namespace: 'Bad!' })).status).toBe(400)
  })
  it('maps a refused cluster read to 403 and an unreachable one to 502', async () => {
    historyMock.mockResolvedValue({ ok: false, error: 'forbidden' })
    expect((await get()).status).toBe(403)
    historyMock.mockResolvedValue({ ok: false, error: 'unreachable' })
    expect((await get()).status).toBe(502)
  })
})
