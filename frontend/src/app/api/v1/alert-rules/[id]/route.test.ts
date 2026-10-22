import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, findFirstMock, updateMock, updateManyMock, deleteManyMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
  updateManyMock: vi.fn(),
  deleteManyMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage' },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    alertRule: { findFirst: findFirstMock, update: updateMock, updateMany: updateManyMock, deleteMany: deleteManyMock },
  },
}))

import { GET, PUT, PATCH, DELETE } from './route'

const PARAMS = { id: 'rule-1' }
const VALID = { name: 'High CPU', metric: 'cpu', operator: 'gt', threshold: 90, severity: 'critical' }
const NOW = new Date('2026-10-01T00:00:00Z')
const RULE = {
  id: 'rule-1', name: 'High CPU', description: null, enabled: true, metric: 'cpu', operator: 'gt',
  threshold: 90, duration: 0, severity: 'critical', scopeType: 'all', scopeTarget: null, createdAt: NOW, updatedAt: NOW,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  checkPermissionMock.mockResolvedValue(null)
  findFirstMock.mockResolvedValue({ id: 'rule-1' })
  updateMock.mockResolvedValue({})
  updateManyMock.mockResolvedValue({ count: 1 })
  deleteManyMock.mockResolvedValue({ count: 1 })
})

describe('GET /api/v1/alert-rules/[id]', () => {
  it('200 returns the rule', async () => {
    findFirstMock.mockResolvedValue(RULE)
    const res = await callRoute(GET, { params: PARAMS })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data.id).toBe('rule-1')
  })

  it('404 "Rule not found"', async () => {
    findFirstMock.mockResolvedValue(null)
    const res = await callRoute(GET, { params: PARAMS })
    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toBe('Rule not found')
  })

  it('500 "Server error" when the lookup throws without a message', async () => {
    findFirstMock.mockRejectedValue({})
    const res = await callRoute(GET, { params: PARAMS })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('Server error')
  })
})

describe('PUT /api/v1/alert-rules/[id]', () => {
  it('404 "Rule not found"', async () => {
    findFirstMock.mockResolvedValue(null)
    const res = await callRoute(PUT, { method: 'PUT', params: PARAMS, body: VALID })
    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toBe('Rule not found')
  })

  it.each([
    [{ ...VALID, name: '' }, 'Name is required'],
    [{ ...VALID, metric: 'bogus' }, 'Invalid metric'],
    [{ ...VALID, operator: 'bogus' }, 'Invalid operator'],
    [{ ...VALID, threshold: null }, 'Invalid threshold'],
    [{ ...VALID, severity: 'fatal' }, 'Invalid severity'],
  ])('400 on invalid body %#', async (body, message) => {
    const res = await callRoute(PUT, { method: 'PUT', params: PARAMS, body })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe(message)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('200 "Rule updated"', async () => {
    const res = await callRoute(PUT, { method: 'PUT', params: PARAMS, body: VALID })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).message).toBe('Rule updated')
  })

  it('500 "Server error" when update throws without a message', async () => {
    updateMock.mockRejectedValue({})
    const res = await callRoute(PUT, { method: 'PUT', params: PARAMS, body: VALID })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('Server error')
  })
})

describe('PATCH /api/v1/alert-rules/[id]', () => {
  it('404 "Rule not found"', async () => {
    updateManyMock.mockResolvedValue({ count: 0 })
    const res = await callRoute(PATCH, { method: 'PATCH', params: PARAMS, body: { enabled: true } })
    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toBe('Rule not found')
  })

  it('200 "Rule enabled"', async () => {
    const res = await callRoute(PATCH, { method: 'PATCH', params: PARAMS, body: { enabled: true } })
    expect((await readJson<any>(res)).message).toBe('Rule enabled')
  })

  it('200 "Rule disabled"', async () => {
    const res = await callRoute(PATCH, { method: 'PATCH', params: PARAMS, body: { enabled: false } })
    expect((await readJson<any>(res)).message).toBe('Rule disabled')
  })

  it('500 "Server error" when updateMany throws without a message', async () => {
    updateManyMock.mockRejectedValue({})
    const res = await callRoute(PATCH, { method: 'PATCH', params: PARAMS, body: { enabled: true } })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('Server error')
  })
})

describe('DELETE /api/v1/alert-rules/[id]', () => {
  it('404 "Rule not found"', async () => {
    deleteManyMock.mockResolvedValue({ count: 0 })
    const res = await callRoute(DELETE, { method: 'DELETE', params: PARAMS })
    expect(res.status).toBe(404)
    expect((await readJson<any>(res)).error).toBe('Rule not found')
  })

  it('200 "Rule deleted"', async () => {
    const res = await callRoute(DELETE, { method: 'DELETE', params: PARAMS })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).message).toBe('Rule deleted')
  })

  it('500 "Server error" when deleteMany throws without a message', async () => {
    deleteManyMock.mockRejectedValue({})
    const res = await callRoute(DELETE, { method: 'DELETE', params: PARAMS })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('Server error')
  })
})
