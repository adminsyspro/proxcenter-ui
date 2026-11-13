import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getPrincipal: vi.fn<() => Promise<any>>(),
  getRBACContext: vi.fn<() => Promise<any>>(),
  checkPermission: vi.fn<(p: string) => Promise<Response | null>>(),
  hasPermission: vi.fn<(input: unknown) => Promise<boolean>>(),
}))

vi.mock('@/lib/auth/principal', () => ({ getPrincipal: () => h.getPrincipal() }))
vi.mock('@/lib/rbac', () => ({
  getRBACContext: () => h.getRBACContext(),
  checkPermission: (p: string) => h.checkPermission(p),
  hasPermission: (input: unknown) => h.hasPermission(input),
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'acme' }))

import { authorizeAdminRead, authorizeAdminWrite, getActingSession, getActingUser, getTokenCaller, ownRolesError } from './actingUser'

const SESSION = { kind: 'session', userId: 'u1', userEmail: 'a@b.c', tenantId: 'default', connectionIds: null }
const TOKEN = { kind: 'token', tokenId: 't1', tenantId: 'default', creatorUserId: 'creator', connectionIds: null }

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

describe('authorizeAdminWrite', () => {
  it('holds a session to the permission in its current tenant, and protects its own account', async () => {
    h.getRBACContext.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 'default', principal: SESSION })
    h.hasPermission.mockResolvedValue(true)
    expect(await authorizeAdminWrite('admin.rbac')).toEqual({ denied: null, userId: 'u1', userEmail: 'a@b.c', selfUserId: 'u1', isToken: false })
    expect(h.hasPermission).toHaveBeenCalledWith({ userId: 'u1', permission: 'admin.rbac', tenantId: 'acme' })
    expect(h.checkPermission).not.toHaveBeenCalled()

    h.hasPermission.mockResolvedValue(false)
    const { denied } = await authorizeAdminWrite('admin.rbac')
    expect(denied?.status).toBe(403)
    expect(await denied?.json()).toEqual({ error: 'Admin rights required' })
  })

  it('holds a token to the permission of its scope, carries no user and protects its creator', async () => {
    h.getRBACContext.mockResolvedValue({ isAdmin: false, tenantId: 'default', principal: TOKEN })
    expect(await authorizeAdminWrite('admin.rbac')).toEqual({ denied: null, selfUserId: 'creator', isToken: true })
    expect(h.checkPermission).toHaveBeenCalledWith('admin.rbac')
    expect(h.hasPermission).not.toHaveBeenCalled()

    const refusal = new Response('{}', { status: 403 })
    h.checkPermission.mockResolvedValue(refusal)
    expect((await authorizeAdminWrite('admin.rbac')).denied).toBe(refusal)

    h.getRBACContext.mockResolvedValue({ isAdmin: false, tenantId: 'default', principal: { ...TOKEN, creatorUserId: null } })
    expect((await authorizeAdminWrite('admin.rbac')).selfUserId).toBeNull()
  })

  it('answers 401 Unauthorized without a caller', async () => {
    h.getRBACContext.mockResolvedValue(null)
    const { denied, selfUserId } = await authorizeAdminWrite('admin.rbac')
    expect(denied?.status).toBe(401)
    expect(selfUserId).toBeNull()
  })
})

describe('getTokenCaller / ownRolesError', () => {
  it('names the creator of a token, and is null for a session or no caller', async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: TOKEN })
    expect(await getTokenCaller()).toEqual({ creatorUserId: 'creator' })
    h.getPrincipal.mockResolvedValue({ ok: true, principal: { ...TOKEN, creatorUserId: undefined } })
    expect(await getTokenCaller()).toEqual({ creatorUserId: null })
    for (const result of [{ ok: true, principal: SESSION }, { ok: true }, { ok: false }]) {
      h.getPrincipal.mockResolvedValue(result)
      expect(await getTokenCaller()).toBeNull()
    }
  })

  it('words the refusal for a session and for a token', () => {
    expect(ownRolesError({ isToken: false }, 'change')).toBe('You cannot change your own roles')
    expect(ownRolesError({ isToken: false }, 'revoke')).toBe('You cannot revoke your own roles')
    expect(ownRolesError({ isToken: true }, 'revoke')).toBe('An API token cannot revoke the roles of its creator')
  })
})
