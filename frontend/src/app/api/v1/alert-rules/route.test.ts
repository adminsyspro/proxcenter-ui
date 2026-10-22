import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, findManyMock, createMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  findManyMock: vi.fn(),
  createMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage' },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { alertRule: { findMany: findManyMock, create: createMock } },
}))

import { GET, POST, METRIC_TYPES, OPERATORS, SCOPE_TYPES } from './route'

const VALID = { name: 'High CPU', metric: 'cpu', operator: 'gt', threshold: 90, severity: 'warning' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  checkPermissionMock.mockResolvedValue(null)
  findManyMock.mockResolvedValue([])
  createMock.mockResolvedValue({})
})

describe('alert-rules metadata labels', () => {
  it('exposes English labels', () => {
    expect(METRIC_TYPES.disk.label).toBe('Disk (%)')
    expect(METRIC_TYPES.uptime.label).toBe('Uptime (days)')
    expect(METRIC_TYPES.node_offline.label).toBe('Node offline')
    expect(METRIC_TYPES.vm_stopped.label).toBe('VM stopped')
    expect(OPERATORS.gte.description).toBe('greater than or equal to')
    expect(OPERATORS.neq.description).toBe('not equal to')
    expect(SCOPE_TYPES.all.label).toBe('All')
    expect(SCOPE_TYPES.vm.label).toBe('Specific VM')
  })
})

describe('GET /api/v1/alert-rules', () => {
  it('returns the rules with English metadata', async () => {
    const now = new Date('2026-10-01T00:00:00Z')
    findManyMock.mockResolvedValue([
      { id: 'r1', name: 'n', description: null, enabled: true, metric: 'disk', operator: 'gte', threshold: 80, duration: 0, severity: 'info', scopeType: 'all', scopeTarget: null, createdAt: now, updatedAt: now },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data[0].metricLabel).toBe('Disk (%)')
    expect(body.meta.scopeTypes.connection.label).toBe('Specific connection')
  })

  it('500 with the fallback message when the query throws without a message', async () => {
    findManyMock.mockRejectedValue({})
    const res = await GET()
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('Server error')
  })
})

describe('POST /api/v1/alert-rules', () => {
  it.each([
    [{ ...VALID, name: '  ' }, 'Name is required'],
    [{ ...VALID, metric: 'bogus' }, 'Invalid metric'],
    [{ ...VALID, operator: 'bogus' }, 'Invalid operator'],
    [{ ...VALID, threshold: 'abc' }, 'Invalid threshold'],
    [{ ...VALID, severity: 'fatal' }, 'Invalid severity'],
  ])('400 on invalid body %#', async (body, message) => {
    const res = await callRoute(POST, { body })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe(message)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('201 with "Rule created"', async () => {
    const res = await callRoute(POST, { body: VALID })
    expect(res.status).toBe(201)
    expect((await readJson<any>(res)).message).toBe('Rule created')
  })

  it('500 with the fallback message when create throws without a message', async () => {
    createMock.mockRejectedValue({})
    const res = await callRoute(POST, { body: VALID })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('Server error')
  })
})
