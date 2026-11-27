import { describe, it, expect, vi, beforeEach } from 'vitest'

const getServerSessionMock = vi.fn()
const findUniqueTenantMock = vi.fn()
const userHasAccessMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...a: any[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { tenant: { findUnique: (...a: any[]) => findUniqueTenantMock(...a) } } }))
vi.mock('@/lib/tenant', () => ({
  userHasAccessToTenant: (...a: any[]) => userHasAccessMock(...a),
  DEFAULT_TENANT_ID: 'default',
}))

import { resolveStrictTenant } from './strictTenant'

beforeEach(() => {
  getServerSessionMock.mockReset()
  findUniqueTenantMock.mockReset().mockResolvedValue({ enabled: true })
  userHasAccessMock.mockReset().mockResolvedValue(true)
})

describe('resolveStrictTenant', () => {
  it('401 when no session user', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const r = await resolveStrictTenant()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(401)
  })
  it('403 when session has no tenantId', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    const r = await resolveStrictTenant()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  })
  it('403 when tenant disabled', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } })
    findUniqueTenantMock.mockResolvedValue({ enabled: false })
    const r = await resolveStrictTenant()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  })
  it('403 when user not a member', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } })
    userHasAccessMock.mockResolvedValue(false)
    const r = await resolveStrictTenant()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
  })
  it('ok with tenantId when valid', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } })
    const r = await resolveStrictTenant()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.tenantId).toBe('t1')
  })
})
