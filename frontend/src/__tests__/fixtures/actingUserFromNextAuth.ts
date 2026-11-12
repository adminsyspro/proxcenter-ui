// Test double of @/lib/auth/actingUser for the route tests written against a
// mocked next-auth session (issue #1360 moved those routes to getPrincipal).
// Every function reads the test file's own `getServerSession` mock, and the
// super-admin verdict its own `@/lib/rbac` mock, so each test keeps driving
// the session path exactly as before. The token path is covered by
// actingUser.test.ts and the token scope tests of the routes.
type SessionLike = { user?: { id?: string; email?: string } } | null

async function readSession(): Promise<SessionLike> {
  const { getServerSession } = (await import("next-auth")) as unknown as { getServerSession: (o?: unknown) => Promise<SessionLike> }
  return (await getServerSession({})) ?? null
}

async function superAdmin(userId: string): Promise<boolean> {
  const rbac = (await import("@/lib/rbac")) as unknown as { isUserSuperAdmin?: (id: string) => Promise<boolean> }
  return typeof rbac.isUserSuperAdmin === "function" ? !!(await rbac.isUserSuperAdmin(userId)) : false
}

export function actingUserFromNextAuth() {
  const getActingUser = async () => {
    const user = (await readSession())?.user
    return user?.id ? { id: user.id, email: user.email } : null
  }
  return {
    getActingUser,
    getActingSession: async () => {
      const user = await getActingUser()
      return user ? { user } : null
    },
    authorizeAdminRead: async () => {
      const user = await getActingUser()
      if (!user) return { denied: Response.json({ error: "Unauthorized" }, { status: 401 }), isSuperAdmin: false }
      return { denied: null, userId: user.id, isSuperAdmin: await superAdmin(user.id) }
    },
  }
}

/**
 * Test double of @/lib/auth/principal's getPrincipal for the same tests: the
 * session principal built from the mocked session, as sessionPrincipal does.
 */
export function principalFromNextAuth() {
  return {
    getPrincipal: async () => {
      const user = (await readSession())?.user as { id?: string; email?: string; tenantId?: string } | undefined
      if (!user?.id) return { ok: true }
      return {
        ok: true,
        principal: { kind: "session", userId: user.id, userEmail: user.email, tenantId: user.tenantId || "default", connectionIds: null },
      }
    },
    rejectionToResponse: () => Response.json({ error: "Invalid or expired API token" }, { status: 401 }),
  }
}
