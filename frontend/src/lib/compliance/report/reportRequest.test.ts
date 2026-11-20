import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireEnterprise: vi.fn(),
  denyIaasTenant: vi.fn(),
  verifyConnectionOwnership: vi.fn(),
  checkPermission: vi.fn(),
  getConnectionById: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({ requireEnterprise: h.requireEnterprise }))
vi.mock('@/lib/tenant/iaasGuard', () => ({ denyIaasTenant: h.denyIaasTenant }))
vi.mock('@/lib/tenant', () => ({
  verifyConnectionOwnership: h.verifyConnectionOwnership,
  getSessionPrisma: async () => ({ connection: { findUnique: h.findUnique } }),
  getCurrentTenantId: async () => 't1',
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: h.checkPermission, PERMISSIONS: { ADMIN_COMPLIANCE: 'admin.compliance' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: h.getConnectionById }))

import { resolveReportRequest } from './reportRequest'

const denied = (status: number) => new Response('{}', { status })

beforeEach(() => {
  vi.clearAllMocks()
  h.requireEnterprise.mockResolvedValue(null)
  h.denyIaasTenant.mockResolvedValue(null)
  h.verifyConnectionOwnership.mockResolvedValue(null)
  h.checkPermission.mockResolvedValue(null)
  h.getConnectionById.mockResolvedValue({ id: 'c1', name: 'PVE-PROD' })
  h.findUnique.mockResolvedValue({ sshEnabled: true })
})

const status = async (r: Awaited<ReturnType<typeof resolveReportRequest>>) => ('response' in r ? r.response.status : 200)

describe('resolveReportRequest', () => {
  it('resolves the connection, its SSH setting and the tenant once every guard passes', async () => {
    const r = await resolveReportRequest('cmmc-l2', 'c1')

    expect(r).toEqual({ ok: true, frameworkId: 'cmmc-l2', connectionId: 'c1', conn: { id: 'c1', name: 'PVE-PROD' }, sshEnabled: true, tenantId: 't1' })
    expect(h.checkPermission).toHaveBeenCalledWith('admin.compliance', 'connection', 'c1')
  })

  it('reads a missing SSH row as SSH off', async () => {
    h.findUnique.mockResolvedValue(null)

    expect(await resolveReportRequest('cmmc-l2', 'c1')).toMatchObject({ sshEnabled: false })
  })

  it('refuses each failed guard in order, before reading the cluster', async () => {
    expect(await status(await resolveReportRequest('cmmc-l2', null))).toBe(400)

    h.requireEnterprise.mockResolvedValueOnce(denied(403))
    expect(await status(await resolveReportRequest('cmmc-l2', 'c1'))).toBe(403)

    expect(await status(await resolveReportRequest('nope', 'c1'))).toBe(400)
    expect(await status(await resolveReportRequest(null, 'c1'))).toBe(400)

    h.denyIaasTenant.mockResolvedValueOnce(denied(404))
    expect(await status(await resolveReportRequest('cmmc-l2', 'c1'))).toBe(404)

    h.verifyConnectionOwnership.mockResolvedValueOnce(denied(404))
    expect(await status(await resolveReportRequest('cmmc-l2', 'c1'))).toBe(404)

    h.checkPermission.mockResolvedValueOnce(denied(403))
    expect(await status(await resolveReportRequest('cmmc-l2', 'c1'))).toBe(403)

    h.getConnectionById.mockResolvedValueOnce(null)
    expect(await status(await resolveReportRequest('cmmc-l2', 'c1'))).toBe(404)
  })
})
