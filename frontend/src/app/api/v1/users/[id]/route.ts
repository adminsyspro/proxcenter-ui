// src/app/api/v1/users/[id]/route.ts
import { NextResponse } from "next/server"

import { getActingSession, getTokenCaller } from "@/lib/auth/actingUser"
import { prisma } from "@/lib/db/prisma"
import { hashPassword } from "@/lib/auth/password"
import { safeLog } from "@/lib/log/sanitize"
import { checkPermission, isUserSuperAdmin, PERMISSIONS, PROTECTED_ROLE_IDS } from "@/lib/rbac"
import { isExternalProvider } from "@/lib/auth/localLogin"
import { guardRoleAssignment } from "@/lib/rbac/assignmentGuards"
import { isServiceDeskAccount, SERVICE_DESK_ACCOUNT_ERROR, SERVICE_DESK_ROW_PREFIX } from "@/lib/rbac/serviceDesk"
import { denyIfTargetIsProtectedAndCallerIsNot, findUserInTenant } from "@/lib/rbac/userTargetGuards"
import { nanoid } from "nanoid"
import { DEFAULT_TENANT_ID, addUserToTenant, removeUserFromTenant, TenantMembershipError, getCurrentTenantId } from "@/lib/tenant"
import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

const TOKEN_ON_CREATOR = "An API token cannot change or delete the account of its creator"

// GET /api/v1/users/[id] - Récupérer un utilisateur
async function handleGet(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // RBAC: admin.users.view, implied by admin.users (API tokens: users:read)
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS_VIEW)
    if (denied) return denied

    const { id } = await params
    const session = await getActingSession()
    const superAdminBlock = await denyIfTargetIsProtectedAndCallerIsNot(id, session?.user?.id)
    if (superAdminBlock) return superAdminBlock

    const tenantId = await getCurrentTenantId()
    const isProviderView = tenantId === DEFAULT_TENANT_ID

    // Provider view reads any user regardless of membership in `default` —
    // mirrors the GET list which already exposes the full cross-tenant
    // population to the provider. Tenant-scoped reads stay pinned to the
    // session tenant so a tenant admin can't enumerate users from another
    // tenant by guessing IDs.
    const user = isProviderView
      ? await prisma.user.findUnique({ where: { id } })
      : await findUserInTenant(id, tenantId)

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        auth_provider: user.authProvider,
        local_login_allowed: user.localLoginAllowed,
        enabled: user.enabled,
        last_login_at: user.lastLoginAt?.toISOString() ?? null,
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString(),
      },
    })
  } catch (error: any) {
    console.error("GET user error:", error)
    return NextResponse.json({ error: error?.message || "Server error" }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("user-get", handleGet)

// PATCH /api/v1/users/[id] - Modifier un utilisateur
async function handlePatch(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getActingSession()
    const { id } = await params
    const body = await req.json()
    const { name, enabled, password, tenantIds, roleId, deleteApiTokens, localLoginAllowed } = body

    // An API token (users:write) never touches the account of its creator,
    // and never sets a credential on an existing account: a leaked token must
    // not turn into a sign-in.
    const tokenCaller = await getTokenCaller()
    if (tokenCaller) {
      if (tokenCaller.creatorUserId === id) {
        return NextResponse.json({ error: TOKEN_ON_CREATOR }, { status: 403 })
      }
      if (password !== undefined || localLoginAllowed !== undefined) {
        return NextResponse.json(
          { error: "An API token cannot set the password or the emergency access of an existing account" },
          { status: 403 }
        )
      }
    }

    const isSelf = session?.user?.id === id
    const selfServiceFields = new Set(["name", "password"])
    const hasAdminFields = Object.keys(body).some(k => !selfServiceFields.has(k))

    // Self-service: users can change their own name/password without admin.users
    // Admin fields (enabled, role, etc.) or editing another user requires admin.users
    if (!isSelf || hasAdminFields) {
      const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)
      if (denied) return denied
    }

    // Prevent self-lockout: a user — including admins — cannot disable their
    // own account. Re-enabling needs another admin.
    if (isSelf && enabled === false) {
      return NextResponse.json(
        { error: "You cannot disable your own account" },
        { status: 400 }
      )
    }

    const superAdminBlock = await denyIfTargetIsProtectedAndCallerIsNot(id, session?.user?.id)
    if (superAdminBlock) return superAdminBlock

    const tenantId = await getCurrentTenantId()
    const isProviderView = tenantId === DEFAULT_TENANT_ID

    // Provider view (default tenant) can edit any user, including those
    // with no membership in `default`. Non-provider views stay scoped to
    // their own memberships, matching the historical behaviour.
    const user = isProviderView
      ? await prisma.user.findUnique({ where: { id } })
      : await findUserInTenant(id, tenantId)
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // The password, the enabled flag and the name are one account for every
    // tenant the user belongs to. A customer tenant administers its own
    // memberships and grants; when the user is also a member elsewhere, the
    // account itself is changed by the provider or by its holder. A field
    // sent back with its current value (the dialog resends the whole form)
    // changes nothing and is not held against the caller.
    // A provider service-desk account is the provider's, in every tenant it
    // reaches (ui#1336).
    if (!isProviderView && !isSelf && (await isServiceDeskAccount(id))) {
      return NextResponse.json(SERVICE_DESK_ACCOUNT_ERROR, { status: 403 })
    }
    if (localLoginAllowed !== undefined && typeof localLoginAllowed !== "boolean") {
      return NextResponse.json({ error: "localLoginAllowed must be a boolean" }, { status: 400 })
    }
    const localLoginChanged = localLoginAllowed !== undefined && localLoginAllowed !== user.localLoginAllowed
    const touchesAccount = Boolean(password)
      || (enabled !== undefined && !!enabled !== user.enabled)
      || (name !== undefined && name !== user.name)
      || localLoginChanged
    if (!isProviderView && !isSelf && touchesAccount) {
      const elsewhere = await prisma.userTenant.count({ where: { userId: id, tenantId: { not: tenantId } } })
      if (elsewhere > 0) {
        return NextResponse.json(
          { error: "This user also belongs to other tenants; their account is managed by the provider", code: "SHARED_ACCOUNT" },
          { status: 403 }
        )
      }
    }

    // Build the Prisma update payload from whitelisted fields only. A field
    // equal to what was just read is left out: writing it back would also
    // overwrite whatever another request set in between (a provider
    // disabling the account while a tenant dialog saves "enabled: true").
    const data: Record<string, unknown> = {}
    if (name !== undefined && name !== user.name) data.name = name
    if (enabled !== undefined && !!enabled !== user.enabled) data.enabled = !!enabled
    // Emergency access: a local password that keeps working once the account
    // is OIDC or LDAP. Only a super admin grants or withdraws it; withdrawing
    // it from an SSO account drops the password with it.
    if (localLoginChanged) {
      if (!session?.user?.id || !(await isUserSuperAdmin(session.user.id))) {
        return NextResponse.json({ error: "Only a super admin may change emergency access" }, { status: 403 })
      }
      data.localLoginAllowed = localLoginAllowed
      if (!localLoginAllowed && isExternalProvider(user.authProvider) && user.password) data.password = null
    }
    const localLoginAfter = localLoginAllowed ?? user.localLoginAllowed
    // Password is owned by the external IdP for SSO/LDAP accounts. Refuse to set
    // a local password on them — it would open a credentials login path that
    // bypasses SSO/MFA — unless the account has emergency access. Covers both
    // admin edits and self-service profile changes.
    if (password && isExternalProvider(user.authProvider) && !localLoginAfter) {
      return NextResponse.json(
        { error: "The password is managed by the identity provider (OIDC/LDAP) and cannot be set here." },
        { status: 403 }
      )
    }
    if (password) {
      if (password.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters" },
          { status: 400 }
        )
      }
      data.password = await hashPassword(password)
    }

    const requestedTenantIds = Array.isArray(tenantIds)
      ? (tenantIds.filter((x: unknown) => typeof x === "string" && x.length > 0) as string[])
      : null

    // Role checks run before anything is written, membership changes included.
    if (roleId !== undefined) {
      if (!isProviderView) {
        return NextResponse.json(
          { error: "Cross-tenant role propagation is only available from the provider tenant" },
          { status: 403 }
        )
      }
      // Same rule as /rbac/assignments: nobody changes their own roles.
      if (isSelf) {
        return NextResponse.json({ error: "You cannot change your own roles" }, { status: 400 })
      }
      if (typeof roleId === "string" && roleId.length > 0) {
        if ((PROTECTED_ROLE_IDS as readonly string[]).includes(roleId)) {
          return NextResponse.json(
            { error: "Protected roles can't be assigned through this endpoint" },
            { status: 403 }
          )
        }
        // The role lands in every tenant the user ends up a member of, so it
        // obeys the rules of every grant (lib/rbac/assignmentGuards.ts) in
        // each of them (roadmap#97).
        const targetTenantIds = requestedTenantIds
          ? [...requestedTenantIds]
          : (await prisma.userTenant.findMany({ where: { userId: id }, select: { tenantId: true } })).map(m => m.tenantId)
        // No membership: nothing is granted, the role must still exist.
        if (targetTenantIds.length === 0) targetTenantIds.push(DEFAULT_TENANT_ID)
        for (const targetTenantId of new Set(targetTenantIds)) {
          const guard = await guardRoleAssignment({
            callerUserId: session?.user?.id ?? "",
            roleId,
            targetTenantId,
            targetUserId: id,
          })
          if (!guard.ok) return guard.response!
        }
      }
    }

    // Tenant assignments reconciliation. Only honored from the provider
    // view (default tenant) — a tenant-admin scoped to OVH must never be
    // able to grant a user access to a foreign tenant via this endpoint.
    // Uses the shared addUserToTenant / removeUserFromTenant helpers so
    // the SUPER_ADMIN_PROTECTED and LAST_TENANT guards still apply.
    let tenantsChanged: { added: string[]; removed: string[] } | null = null
    if (requestedTenantIds) {
      if (!isProviderView) {
        return NextResponse.json(
          { error: "Tenant assignments can only be edited from the provider tenant" },
          { status: 403 }
        )
      }
      const requested = new Set(requestedTenantIds)
      const current = new Set(
        (await prisma.userTenant.findMany({ where: { userId: id }, select: { tenantId: true } })).map(r => r.tenantId)
      )
      const toAdd = [...requested].filter(t => !current.has(t))
      const toRemove = [...current].filter(t => !requested.has(t))

      try {
        for (const t of toAdd) await addUserToTenant(id, t, false)
        for (const t of toRemove) await removeUserFromTenant(id, t)
      } catch (e) {
        if (e instanceof TenantMembershipError) {
          const status = e.code === "LAST_TENANT" ? 409 : e.code === "SUPER_ADMIN_PROTECTED" ? 403 : 404
          return NextResponse.json({ error: e.message, code: e.code }, { status })
        }
        throw e
      }
      tenantsChanged = { added: toAdd, removed: toRemove }
    }

    // RBAC role propagation. From the provider view, choosing a role in
    // the global user dialog applies it across every tenant the user is
    // a member of (after the tenantIds reconciliation above). This
    // mirrors the most common MSP intent — same role everywhere — while
    // still allowing per-tenant divergence through Settings → Tenants
    // → tenant-X → users (which posts to /tenants/:id/users with a
    // specific roleId).
    //
    // - roleId === undefined  → no change (backward compat)
    // - roleId === null | ''  → drop every non-protected role grant of this user
    // - otherwise             → drop existing non-protected grants, create the
    //                            new role on every membership (skip protected
    //                            role IDs entirely; they're managed via
    //                            /api/v1/rbac/assignments only)
    let rolesChanged: { applied: string | null; tenantCount: number } | null = null
    if (roleId !== undefined) {
      const memberships = await prisma.userTenant.findMany({
        where: { userId: id },
        select: { tenantId: true },
      })

      const grantedById = session?.user?.id || null
      const now = new Date()

      // Safety net: if this PATCH would strip the target's protected grants
      // (super_admin / provider_admin) AND the target is currently the last
      // active holder of role_super_admin, refuse — the platform would lock
      // itself out. Provider_admin is co-equivalent in blast radius but is
      // not a hard floor; we only guard super_admin here.
      const wouldStripProtected =
        // explicit demotion: a non-protected role was picked → all grants drop
        typeof roleId === "string" && roleId.length > 0 &&
        !(PROTECTED_ROLE_IDS as readonly string[]).includes(roleId)
      if (wouldStripProtected) {
        const isTargetSuperAdmin = await prisma.rbacUserRole.findFirst({
          where: {
            userId: id,
            roleId: "role_super_admin",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { id: true },
        })
        if (isTargetSuperAdmin) {
          const otherSuperAdmins = await prisma.rbacUserRole.findFirst({
            where: {
              userId: { not: id },
              roleId: "role_super_admin",
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            select: { id: true },
          })
          if (!otherSuperAdmins) {
            return NextResponse.json(
              {
                error: "Cannot demote the last super_admin. Grant role_super_admin to another user first.",
                code: "LAST_SUPER_ADMIN",
              },
              { status: 409 }
            )
          }
        }
      }

      await prisma.$transaction(async tx => {
        // When the admin picks a non-protected role, fully replace every
        // existing grant — including protected ones — so the resulting
        // state matches what they selected. The last-super-admin safety
        // check above blocks the only scenario where this could lock the
        // platform out. When the admin clears the role (null / empty
        // string) we keep protected grants intact: the dialog has no UI
        // to demote a super_admin to "no role at all", that action goes
        // through Security > RBAC > Assignments.
        await tx.rbacUserRole.deleteMany({
          where: {
            userId: id,
            ...(wouldStripProtected ? {} : { roleId: { notIn: [...PROTECTED_ROLE_IDS] } }),
            // Service-desk rows follow their assignment (ui#1336), not this dialog.
            NOT: { id: { startsWith: SERVICE_DESK_ROW_PREFIX } },
          },
        })
        if (typeof roleId === "string" && roleId.length > 0) {
          for (const m of memberships) {
            await tx.rbacUserRole.create({
              data: {
                id: `tenant_role_${m.tenantId}_${id}_${nanoid(6)}`,
                userId: id,
                roleId,
                // inherit so the assignment follows the role's default scope (issue #383)
                scopeType: "inherit",
                tenantId: m.tenantId,
                grantedById,
                grantedAt: now,
              },
            })
          }
        }
      })
      rolesChanged = {
        applied: typeof roleId === "string" && roleId.length > 0 ? roleId : null,
        tenantCount: memberships.length,
      }
    }

    const wantsTokenDeletion = deleteApiTokens === true

    // Account fields sent back unchanged are a valid no-op (the dialog
    // resends its form); an empty body is still a client error.
    const accountFieldsSent = name !== undefined || enabled !== undefined || localLoginAllowed !== undefined
    if (Object.keys(data).length === 0 && !tenantsChanged && !rolesChanged && !wantsTokenDeletion && !accountFieldsSent) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 })
    }

    if (Object.keys(data).length > 0) data.updatedAt = new Date()

    // Offboarding (#632). A pxc_ token created by this user keeps
    // authenticating after the account is disabled — that is decision D3 of
    // the token spec, so that a departure never silently takes monitoring
    // down. The admin who disables the account is the one who gets to
    // decide, and the disable dialog now shows them the live tokens and
    // asks. When they say yes, we act here.
    //
    // Ordered BEFORE prisma.user.update on purpose. The invariant that
    // matters is: this request never disables the account while leaving the
    // tokens live. A failing deletion therefore has to abort before the
    // `enabled` write, not after it — the reverse order would answer 500 to
    // an admin whose account edit went through, and they would reasonably
    // read the disabled account as proof the tokens died with it.
    //
    // Scope of that guarantee, precisely: only the `data` update below. The
    // tenantIds reconciliation and the roleId propagation above have already
    // committed by the time we get here, so a PATCH combining those with
    // deleteApiTokens can still fail with memberships and RBAC grants
    // changed. Widening the guarantee would mean wrapping the whole handler
    // in one transaction, which is a bigger change than this issue calls
    // for; the security-relevant pairing (disable + delete) is the one that
    // is held.
    let tokensDeleted: { count: number; tokens: { id: string; name: string; tokenPrefix: string }[] } | null = null
    if (wantsTokenDeletion) {
      const { deleteTokensCreatedBy } = await import("@/lib/api-tokens/creatorTokens")

      // A tenant-scoped admin only reaches the tokens of the tenant they
      // are acting from; the provider view reaches every one of them.
      tokensDeleted = await deleteTokensCreatedBy(id, isProviderView ? undefined : tenantId)
      if (tokensDeleted.count > 0) {
        console.log(`[api-tokens] deleted ${tokensDeleted.count} token(s) created by ${safeLog(id)}`)
      }
    }

    const updated = Object.keys(data).length > 0
      ? await prisma.user.update({ where: { id }, data })
      : user

    // A password change (or a disable) must kill the sessions that are already
    // open, otherwise a stolen cookie survives the exact action a compromised
    // user takes to defend themselves. No exception sid: the caller's own
    // session goes too, which is the expected outcome of "change my password".
    if (password || data.enabled === false || data.password === null) {
      try {
        const { revokeAllSessions } = await import("@/lib/auth/sessions")
        const revoked = await revokeAllSessions(id)
        if (revoked > 0) {
          console.log(`[auth-session] revoked ${revoked} session(s) for ${safeLog(id)}`)
        }
      } catch (e: any) {
        // The password is already changed; failing the request now would be
        // worse than leaving the sweep to the next read-path evaluation.
        console.error('[auth-session] revocation after credential change failed:', e?.message ?? e)
      }
    }

    // Audit
    const { audit } = await import("@/lib/audit")
    const changes: Record<string, any> = {}
    if (data.name !== undefined) changes.name = data.name
    if (data.enabled !== undefined) changes.enabled = data.enabled
    if (password) changes.passwordChanged = true
    if (data.localLoginAllowed !== undefined) changes.localLoginAllowed = data.localLoginAllowed
    if (data.password === null) changes.passwordRemoved = true
    if (tenantsChanged && (tenantsChanged.added.length > 0 || tenantsChanged.removed.length > 0)) {
      changes.tenants = tenantsChanged
    }
    if (rolesChanged) {
      changes.role = rolesChanged
    }
    if (tokensDeleted) {
      // Prefixes, never secrets: the prefix is the public half already shown
      // in the tokens table, and it is what an operator reads to recognise
      // which integration just lost its credential.
      changes.apiTokensDeleted = {
        count: tokensDeleted.count,
        prefixes: tokensDeleted.tokens.map(t => t.tokenPrefix),
      }
    }

    await audit({
      action: "update",
      category: "users",
      resourceType: "user",
      resourceId: id,
      resourceName: updated.email,
      details: changes,
      status: "success",
    })

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        auth_provider: updated.authProvider,
        local_login_allowed: updated.localLoginAllowed,
        enabled: updated.enabled,
        last_login_at: updated.lastLoginAt?.toISOString() ?? null,
        created_at: updated.createdAt.toISOString(),
        updated_at: updated.updatedAt.toISOString(),
        api_tokens_deleted: tokensDeleted?.count ?? 0,
      },
    })
  } catch (error: any) {
    console.error("PATCH user error:", error)
    return NextResponse.json({ error: error?.message || "Server error" }, { status: 500 })
  }
}

// DELETE /api/v1/users/[id] - Supprimer un utilisateur
async function handleDelete(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)
    if (denied) return denied

    const session = await getActingSession()
    const { id } = await params
    if ((await getTokenCaller())?.creatorUserId === id) {
      return NextResponse.json({ error: TOKEN_ON_CREATOR }, { status: 403 })
    }
    const superAdminBlock = await denyIfTargetIsProtectedAndCallerIsNot(id, session?.user?.id)
    if (superAdminBlock) return superAdminBlock

    const tenantId = await getCurrentTenantId()
    const isProviderView = tenantId === DEFAULT_TENANT_ID

    // Provider view operates on the global user record: the delete button on
    // /security/users reads from a cross-tenant list, so it must also act
    // cross-tenant. Tenant-scoped callers still look the user up through
    // their own membership so they can't reach users in other tenants.
    const user = isProviderView
      ? await prisma.user.findUnique({ where: { id } })
      : await findUserInTenant(id, tenantId)
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Empêcher la suppression de son propre compte
    if (user.id === session?.user?.id) {
      return NextResponse.json(
        { error: "You cannot delete your own account" },
        { status: 400 }
      )
    }

    // A provider service-desk account is the provider's (ui#1336).
    if (!isProviderView && (await isServiceDeskAccount(id))) {
      return NextResponse.json(SERVICE_DESK_ACCOUNT_ERROR, { status: 403 })
    }

    // Offboarding (#632), opt-in through ?deleteApiTokens=true. This MUST run
    // before the account delete: `created_by_user_id` is ON DELETE SET NULL,
    // so once the account is gone the tokens it created can no longer be
    // found by creator and the chance to act on them is lost for good.
    //
    // Without the flag the tokens are LEFT ALIVE, which is the documented
    // behaviour (spec D3) and is why `created_by_email` exists — provenance
    // has to outlive the account for every token the operator chose to keep.
    let tokensDeleted: { count: number; tokens: { id: string; name: string; tokenPrefix: string }[] } | null = null
    if (new URL(req.url).searchParams.get("deleteApiTokens") === "true") {
      const { deleteTokensCreatedBy } = await import("@/lib/api-tokens/creatorTokens")

      tokensDeleted = await deleteTokensCreatedBy(id, isProviderView ? undefined : tenantId)
      if (tokensDeleted.count > 0) {
        console.log(`[api-tokens] deleted ${tokensDeleted.count} token(s) created by ${safeLog(id)}`)
      }
    }

    if (isProviderView) {
      // Provider view: hard-delete the user across every tenant + drop every
      // RBAC grant. Matches the UX of the global user list — "delete this
      // user" means remove them from the platform, not from one tenant.
      // Membership rows cascade off the user delete, but we strip RBAC
      // explicitly first to avoid FK-on-delete edge cases with concurrent
      // reads.
      await prisma.$transaction([
        prisma.rbacUserRole.deleteMany({ where: { userId: id } }),
        prisma.rbacUserPermission.deleteMany({ where: { userId: id } }),
        prisma.userTenant.deleteMany({ where: { userId: id } }),
        prisma.user.delete({ where: { id } }),
      ])
    } else {
      // Tenant-scoped view: drop the membership in the current tenant first,
      // then hard-delete only if no membership remains anywhere. Strips
      // RBAC grants scoped to that tenant on the partial-delete path so we
      // don't leave a dead-weight role tied to a tenant the user no longer
      // belongs to.
      await prisma.userTenant.delete({
        where: { userId_tenantId: { userId: id, tenantId } },
      })

      const remainingMemberships = await prisma.userTenant.count({ where: { userId: id } })

      if (remainingMemberships === 0) {
        await prisma.$transaction([
          prisma.rbacUserRole.deleteMany({ where: { userId: id } }),
          prisma.rbacUserPermission.deleteMany({ where: { userId: id } }),
          prisma.user.delete({ where: { id } }),
        ])
      } else {
        await prisma.$transaction([
          prisma.rbacUserRole.deleteMany({ where: { userId: id, tenantId } }),
          prisma.rbacUserPermission.deleteMany({ where: { userId: id, tenantId } }),
        ])
      }
    }

    // Audit
    const { audit } = await import("@/lib/audit")
    await audit({
      action: "delete",
      category: "users",
      resourceType: "user",
      resourceId: id,
      resourceName: user.email,
      details: tokensDeleted
        ? { apiTokensDeleted: { count: tokensDeleted.count, prefixes: tokensDeleted.tokens.map(t => t.tokenPrefix) } }
        : {},
      status: "success",
    })

    return NextResponse.json({ success: true, api_tokens_deleted: tokensDeleted?.count ?? 0 })
  } catch (error: any) {
    console.error("DELETE user error:", error)
    return NextResponse.json({ error: error?.message || "Server error" }, { status: 500 })
  }
}

export const PATCH = withAudit({ category: "users", resourceType: "user", resourceParam: "id" }, withPublicApiGuard("user-update", handlePatch))
export const DELETE = withAudit({ category: "users", resourceType: "user", resourceParam: "id" }, withPublicApiGuard("user-delete", handleDelete))
