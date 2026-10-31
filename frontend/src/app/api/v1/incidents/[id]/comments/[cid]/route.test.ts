import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  tenant: vi.fn(),
  hasFeature: vi.fn(),
  checkPermission: vi.fn(),
  orchestrator: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (id: string) => m.hasFeature(id) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage', ADMIN_SETTINGS: 'admin.settings' },
  checkPermission: (...a: unknown[]) => m.checkPermission(...a),
}))
vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: unknown[]) => m.orchestrator(...a),
}))
vi.mock('@/lib/audit', async () => {
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return m.audit(...a) } }
})

import { DELETE, PATCH } from './route'

const params = { id: 'i1', cid: 'c1' }
const forbidden = () => NextResponse.json({ error: 'Permission denied' }, { status: 403 })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.session.mockResolvedValue({ user: { id: 'u1', name: 'Ops', email: 'ops@lab', tenantId: 'default' } })
  m.tenant.mockResolvedValue('default')
  m.hasFeature.mockResolvedValue(true)
  m.checkPermission.mockResolvedValue(null)
  m.audit.mockResolvedValue('a1')
  m.orchestrator.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (!opts?.method) return { id: 'i1', comments: [{ id: 'c1', author_id: 'someone-else' }] }
    return { status: 'deleted' }
  })
})

describe('DELETE /incidents/[id]/comments/[cid]', () => {
  it('403 for a non-author without admin.settings, nothing deleted', async () => {
    m.checkPermission.mockImplementation(async (p: string) => (p === 'admin.settings' ? forbidden() : null))
    const res = await callRoute(DELETE as any, { method: 'DELETE', params })
    expect(res.status).toBe(403)
    expect(m.orchestrator).toHaveBeenCalledTimes(1)
  })

  it('200 for a non-author with admin.settings', async () => {
    const res = await callRoute(DELETE as any, { method: 'DELETE', params })
    expect(res.status).toBe(200)
    expect(m.orchestrator).toHaveBeenLastCalledWith('/incidents/i1/comments/c1', { method: 'DELETE' })
  })

  it('200 for the author without asking admin.settings', async () => {
    m.orchestrator.mockImplementation(async (_p: string, opts?: { method?: string }) =>
      opts?.method ? { status: 'deleted' } : { id: 'i1', comments: [{ id: 'c1', author_id: 'u1' }] })
    m.checkPermission.mockImplementation(async (p: string) => (p === 'admin.settings' ? forbidden() : null))
    expect((await callRoute(DELETE as any, { method: 'DELETE', params })).status).toBe(200)
  })

  it('404 for a comment the incident does not have', async () => {
    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'i1', cid: 'zzz' } })
    expect(res.status).toBe(404)
    expect(m.orchestrator).toHaveBeenCalledTimes(1)
  })
})

describe('PATCH /incidents/[id]/comments/[cid]', () => {
  it('sends the session user as author, whatever the body says', async () => {
    m.orchestrator.mockResolvedValue({ id: 'c1' })
    const res = await callRoute(PATCH as any, { method: 'PATCH', params, body: { body: 'edited', author_id: 'forged' } })
    expect(res.status).toBe(200)
    expect(m.orchestrator).toHaveBeenCalledWith('/incidents/i1/comments/c1', { method: 'PATCH', body: { body: 'edited', author_id: 'u1' } })
  })

  it('400 invalid_body above 4000 characters', async () => {
    const res = await callRoute(PATCH as any, { method: 'PATCH', params, body: { body: 'x'.repeat(4001) } })
    expect(res.status).toBe(400)
    expect(m.orchestrator).not.toHaveBeenCalled()
  })
})
