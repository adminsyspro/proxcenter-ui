// src/app/api/v1/users/[id]/route.ts
import { NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { hashPassword } from "@/lib/auth/password"
import { checkPermission, PERMISSIONS, isUserSuperAdmin, isUserProtected, PROTECTED_ROLE_IDS, PROVIDER_ONLY_ROLE_IDS } from "@/lib/rbac"
import { nanoid } from "nanoid"
import { DEFAULT_TENANT_ID, addUserToTenant, removeUserFromTenant, TenantMembershipError, getCurrentTenantId } from "@/lib/tenant"

/**
 * Hide provider-level accounts (super_admin + provider_admin) from
 * non-super-admin callers. Returns 404 rather than 403 so existence is not
 * leaked.
 */
async function denyIfTargetIsProtectedAndCallerIsNot(
  targetUserId: string,
  callerUserId: string | undefined
): Promise<NextResponse | null> {
  if (!(await isUserProtected(targetUserId))) return null
  if (callerUserId && (await isUserSuperAdmin(callerUserId))) return null
  return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
}

/**
 * Fetch a user that belongs to the given tenant. Returns the full Prisma row
 * or null if the user doesn't exist or has no membership in this tenant.
 * Centralised so the GET / PATCH / DELETE handlers all use the same lookup
 * + tenant-scoping rules.
 */
async function findUserInTenant(userId: string, tenantId: string) {
  const membership = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { user: true },
  })
  return membership?.user ?? null
}

export const runtime = "nodejs"

// GET /api/v1/users/[id] - Récupérer un utilisateur
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)
    if (denied) return denied

    const { id } = await params
    const session = await getServerSession(authOptions)
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
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        auth_provider: user.authProvider,
        enabled: user.enabled,
        last_login_at: user.lastLoginAt?.toISOString() ?? null,
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString(),
      },
    })
  } catch (error: any) {
    console.error("Erreur GET user:", error)
    return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}

// PATCH /api/v1/users/[id] - Modifier un utilisateur
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    const { id } = await params
    const body = await req.json()
    const { name, enabled, password, tenantIds, roleId } = body

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
        { error: "Vous ne pouvez pas désactiver votre propre compte" },
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
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    // Build the Prisma update payload from whitelisted fields only.
    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (enabled !== undefined) data.enabled = !!enabled
    if (password) {
      if (password.length < 8) {
        return NextResponse.json(
          { error: "Le mot de passe doit contenir au moins 8 caractères" },
          { status: 400 }
        )
      }
      data.password = await hashPassword(password)
    }

    // Tenant assignments reconciliation. Only honored from the provider
    // view (default tenant) — a tenant-admin scoped to OVH must never be
    // able to grant a user access to a foreign tenant via this endpoint.
    // Uses the shared addUserToTenant / removeUserFromTenant helpers so
    // the SUPER_ADMIN_PROTECTED and LAST_TENANT guards still apply.
    let tenantsChanged: { added: string[]; removed: string[] } | null = null
    if (Array.isArray(tenantIds)) {
      if (!isProviderView) {
        return NextResponse.json(
          { error: "Tenant assignments can only be edited from the provider tenant" },
          { status: 403 }
        )
      }
      const requested = new Set(tenantIds.filter((x: unknown) => typeof x === "string" && x.length > 0) as string[])
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
      if (!isProviderView) {
        return NextResponse.json(
          { error: "Cross-tenant role propagation is only available from the provider tenant" },
          { status: 403 }
        )
      }
      if (typeof roleId === "string" && roleId.length > 0 && (PROTECTED_ROLE_IDS as readonly string[]).includes(roleId)) {
        return NextResponse.json(
          { error: "Protected roles can't be assigned through this endpoint" },
          { status: 403 }
        )
      }
      if (typeof roleId === "string" && roleId.length > 0) {
        const exists = await prisma.rbacRole.findUnique({ where: { id: roleId }, select: { id: true } })
        if (!exists) {
          return NextResponse.json({ error: `Unknown role: ${roleId}` }, { status: 400 })
        }
      }

      const memberships = await prisma.userTenant.findMany({
        where: { userId: id },
        select: { tenantId: true },
      })

      // Tenant-forbidden roles (legacy "global" roles: operator / vm_admin /
      // viewer / vm_user) grant automation.view, which would unlock DRS /
      // Site Recovery / Network Security / Resources for a tenant user.
      // The POST /api/v1/rbac/assignments guard already refuses them on
      // non-default tenants; this propagation path was the missing
      // bypass — a direct PATCH with roleId would otherwise propagate
      // such a role across every membership, including tenant clients.
      // Mirror the same rule here.
      if (
        typeof roleId === "string" &&
        roleId.length > 0 &&
        (PROVIDER_ONLY_ROLE_IDS as readonly string[]).includes(roleId) &&
        memberships.some(m => m.tenantId !== DEFAULT_TENANT_ID)
      ) {
        return NextResponse.json(
          { error: "Ce rôle ne peut être assigné que dans le tenant provider (default)" },
          { status: 400 }
        )
      }
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
          },
        })
        if (typeof roleId === "string" && roleId.length > 0) {
          for (const m of memberships) {
            await tx.rbacUserRole.create({
              data: {
                id: `tenant_role_${m.tenantId}_${id}_${nanoid(6)}`,
                userId: id,
                roleId,
                scopeType: "global",
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

    if (Object.keys(data).length === 0 && !tenantsChanged && !rolesChanged) {
      return NextResponse.json({ error: "Aucune modification fournie" }, { status: 400 })
    }

    if (Object.keys(data).length > 0) data.updatedAt = new Date()

    const updated = Object.keys(data).length > 0
      ? await prisma.user.update({ where: { id }, data })
      : user

    // Audit
    const { audit } = await import("@/lib/audit")
    const changes: Record<string, any> = {}
    if (name !== undefined) changes.name = name
    if (enabled !== undefined) changes.enabled = enabled
    if (password) changes.passwordChanged = true
    if (tenantsChanged && (tenantsChanged.added.length > 0 || tenantsChanged.removed.length > 0)) {
      changes.tenants = tenantsChanged
    }
    if (rolesChanged) {
      changes.role = rolesChanged
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
        enabled: updated.enabled,
        last_login_at: updated.lastLoginAt?.toISOString() ?? null,
        created_at: updated.createdAt.toISOString(),
        updated_at: updated.updatedAt.toISOString(),
      },
    })
  } catch (error: any) {
    console.error("Erreur PATCH user:", error)
    return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}

// DELETE /api/v1/users/[id] - Supprimer un utilisateur
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const { id } = await params
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
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    // Empêcher la suppression de son propre compte
    if (user.id === session?.user?.id) {
      return NextResponse.json(
        { error: "Vous ne pouvez pas supprimer votre propre compte" },
        { status: 400 }
      )
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
      details: {},
      status: "success",
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Erreur DELETE user:", error)
    return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}
