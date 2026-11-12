import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getPrincipal: vi.fn<() => Promise<any>>(),
  getRBACContext: vi.fn<() => Promise<any>>(),
  checkPermission: vi.fn<(p: string) => Promise<Response | null>>(),
}))

vi.mock('@/lib/auth/principal', () => ({ getPrincipal: () => h.getPrincipal() }))
vi.mock('@/lib/rbac', () => ({
  getRBACContext: () => h.getRBACContext(),
  checkPermission: (p: string) => h.checkPermission(p),
}))

import { authorizeAdminRead, getActingSession, getActingUser } from './actingUser'

const SESSION = { kind: 'session', userId: 'u1', userEmail: 'a@b.c', tenantId: 'default', connectionIds: null }
const TOKEN = { kind: 'token', tokenId: 't1', tenantId: 'default', connectionIds: null }

beforeEach(() => {
  vi.clearAllMocks()
  h.checkPermission.mockResolvedValue(null)
})

describe('getActingUser / getActingSession', () => {
  it('names the session user, in the next-auth session shape for getActingSession', async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: SESSION })
    expect(await getActingUser()).toEqual({ id: 'u1', email: 'a@b.c' })
    expect(await getActingSession()).toEqual({ user: { id: 'u1', email: 'a@b.c' } })
  })

  it('is null for a token, an anonymous caller and a rejected principal', async () => {
    for (const result of [{ ok: true, principal: TOKEN }, { ok: true }, { ok: false, rejection: { status: 401, body: {} } }]) {
      h.getPrincipal.mockResolvedValue(result)
      expect(await getActingUser()).toBeNull()
      expect(await getActingSession()).toBeNull()
    }
  })
})

describe('authorizeAdminRead', () => {
  it('lets a signed-in session through as before, with its super-admin verdict and no permission check', async () => {
    h.getRBACContext.mockResolvedValue({ userId: 'u1', isAdmin: true, tenantId: 'default', principal: SESSION })
    expect(await authorizeAdminRead('admin.rbac.view')).toEqual({ denied: null, userId: 'u1', isSuperAdmin: true })
    expect(h.checkPermission).not.toHaveBeenCalled()
  })

  it('holds a token to the view permission, and never as a super admin', async () => {
    h.getRBACContext.mockResolvedValue({ isAdmin: false, tenantId: 'default', principal: TOKEN })
    expect(await authorizeAdminRead('admin.rbac.view')).toEqual({ denied: null, isSuperAdmin: false })
    expect(h.checkPermission).toHaveBeenCalledWith('admin.rbac.view')

    const refusal = new Response('{}', { status: 403 })
    h.checkPermission.mockResolvedValue(refusal)
    expect((await authorizeAdminRead('admin.rbac.view')).denied).toBe(refusal)
  })

  it('answers 401 Unauthorized without a caller', async () => {
    h.getRBACContext.mockResolvedValue(null)
    const { denied, isSuperAdmin } = await authorizeAdminRead('admin.rbac.view')
    expect(denied?.status).toBe(401)
    expect(await denied?.json()).toEqual({ error: 'Unauthorized' })
    expect(isSuperAdmin).toBe(false)
  })
})
