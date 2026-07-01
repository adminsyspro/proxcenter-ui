// src/app/api/v1/users/route.ts
import { NextResponse } from "next/server"

import { nanoid } from "nanoid"

import { getServerSession } from "next-auth"

import { prisma } from "@/lib/db/prisma"
import { hashPassword } from "@/lib/auth/password"
import { authOptions } from "@/lib/auth/config"
import { checkPermission, PERMISSIONS, isUserSuperAdmin, PROTECTED_ROLE_IDS } from "@/lib/rbac"
import { DEFAULT_TENANT_ID, getCurrentTenantId } from "@/lib/tenant"
import { getServerLicense } from "@/lib/auth/requireEnterprise"

export const runtime = "nodejs"

/**
 * Compute the set of user IDs that hold a protected (provider-tier) role
 * still active right now. Used to filter the user list shown to non-super-admin
 * callers — they must not enumerate provider operators.
 */
async function loadProtectedUserIds(): Promise<Set<string>> {
  const rows = await prisma.rbacUserRole.findMany({
    where: {
      roleId: { in: [...PROTECTED_ROLE_IDS] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { userId: true },
    distinct: ["userId"],
  })
  return new Set(rows.map(r => r.userId))
}

// GET /api/v1/users - Liste des utilisateurs
export async function GET() {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const isProviderView = tenantId === DEFAULT_TENANT_ID

    // Hide provider-level accounts (super_admin + provider_admin, both
    // wildcard) from non-super-admin callers so a tenant admin — who holds
    // admin.users scoped to their tenant — can't enumerate, edit, or delete
    // a provider operator.
    const session = await getServerSession(authOptions)
    const callerIsSuperAdmin = session?.user?.id ? await isUserSuperAdmin(session.user.id) : false
    const protectedIds = callerIsSuperAdmin ? new Set<string>() : await loadProtectedUserIds()

    // Provider view: in the default tenant we expose every user across the
    // whole platform (gated client-side to Enterprise via the multi-tenancy
    // feature) so a super admin can manage tenant assignments from a
    // single screen. Non-default tenants stay scoped to their own
    // memberships, matching the historical behaviour.
    const visibleUsers = isProviderView
      ? await prisma.user.findMany({
          where: protectedIds.size > 0 ? { id: { notIn: Array.from(protectedIds) } } : undefined,
          orderBy: { createdAt: "desc" },
        })
      : (await prisma.userTenant.findMany({
          where: {
            tenantId,
            ...(protectedIds.size > 0 ? { userId: { notIn: Array.from(protectedIds) } } : {}),
          },
          include: { user: true },
          orderBy: { user: { createdAt: "desc" } },
        })).map(m => m.user)

    // Keep the legacy `memberships` shape downstream code expects (it only
    // reads `.user`), wrapped from the deduplicated user list.
    const memberships = visibleUsers.map(u => ({ user: u, userId: u.id }))

    // Pull every membership of every visible user so the UI can render a
    // tenant-assignment column (multi-tenancy view, gated client-side to
    // Enterprise editions). One round-trip rather than N: we already have
    // the list of user ids and only need (tenantId, tenantName, isDefault).
    // We also flag super-admins (rbac source of truth) so the UI can
    // collapse their list to a single "all tenants" chip — they're
    // pinned to every tenant by design (cf. createTenant).
    const visibleUserIds = memberships.map(m => m.userId)
    const [allMemberships, superAdminRows] = visibleUserIds.length > 0
      ? await Promise.all([
          prisma.userTenant.findMany({
            where: { userId: { in: visibleUserIds } },
            include: { tenant: { select: { id: true, name: true } } },
          }),
          prisma.rbacUserRole.findMany({
            where: {
              userId: { in: visibleUserIds },
              roleId: "role_super_admin",
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: { userId: true },
            distinct: ["userId"],
          }),
        ])
      : [[], []]
    const tenantsByUser = new Map<string, Array<{ id: string; name: string; isDefault: boolean }>>()
    for (const m of allMemberships) {
      const list = tenantsByUser.get(m.userId) ?? []
      list.push({ id: m.tenant.id, name: m.tenant.name, isDefault: m.isDefault })
      tenantsByUser.set(m.userId, list)
    }
    const superAdminIds = new Set(superAdminRows.map(r => r.userId))

    const users = memberships.map(m => ({
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.user.role,
      auth_provider: m.user.authProvider,
      enabled: m.user.enabled,
      totp_enabled: m.user.totpEnabled,
      require_2fa_enrollment: m.user.require2faEnrollment,
      last_login_at: m.user.lastLoginAt?.toISOString() ?? null,
      created_at: m.user.createdAt.toISOString(),
      updated_at: m.user.updatedAt.toISOString(),
      is_super_admin: superAdminIds.has(m.user.id),
      tenants: (tenantsByUser.get(m.user.id) ?? []).sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    }))

    const adminCount = users.filter(u => u.role === "admin").length

    return NextResponse.json({
      data: users,
      meta: {
        total: users.length,
        adminCount,
      },
    })
  } catch (error: any) {
    console.error("Erreur GET users:", error)
    return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}

// POST /api/v1/users - Créer un utilisateur
export async function POST(req: Request) {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)
    if (denied) return denied

    const body = await req.json()
    const { email, password, name, tenantIds } = body

    if (!email || !password) {
      return NextResponse.json({ error: "Email et mot de passe requis" }, { status: 400 })
    }

    // Valider l'email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (email.length > 254 || !emailRegex.test(email)) {
      return NextResponse.json({ error: "Format d'email invalide" }, { status: 400 })
    }

    // Valider le mot de passe
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Le mot de passe doit contenir au moins 8 caractères" },
        { status: 400 }
      )
    }

    const normalisedEmail = email.toLowerCase().trim()

    // Vérifier si l'email existe déjà
    const existing = await prisma.user.findUnique({
      where: { email: normalisedEmail },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: "Cet email est déjà utilisé" }, { status: 400 })
    }

    // Hasher le mot de passe
    const hashedPassword = await hashPassword(password)

    // Créer l'utilisateur + ses adhésions tenant atomiquement.
    //
    // Provider view (`default` tenant) accepts an explicit tenantIds list
    // so a super-admin can create a user already attached to one or more
    // tenants without going through a second round-trip. The first id is
    // marked default. Anywhere else (or when tenantIds is omitted) we
    // auto-attach to the caller's current tenant — historical behaviour.
    const id = nanoid()
    const now = new Date()
    const callerTenantId = await getCurrentTenantId()
    const isProviderView = callerTenantId === DEFAULT_TENANT_ID

    let initialTenantIds: string[]
    if (isProviderView && Array.isArray(tenantIds)) {
      initialTenantIds = (tenantIds as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
      if (initialTenantIds.length === 0) {
        return NextResponse.json(
          { error: "Au moins un tenant doit être sélectionné" },
          { status: 400 }
        )
      }
      // Refuse unknown ids up front so we don't half-create the user and
      // then trip an FK violation deep in the transaction.
      const known = await prisma.tenant.findMany({
        where: { id: { in: initialTenantIds } },
        select: { id: true },
      })
      if (known.length !== initialTenantIds.length) {
        return NextResponse.json({ error: "Un ou plusieurs tenants sont introuvables" }, { status: 400 })
      }
    } else {
      initialTenantIds = [callerTenantId]
    }

    // Community edition has no RBAC role-management UI (that is Enterprise
    // only), so a user created here would otherwise receive zero grants and
    // see nothing after logging in (issue #512). On Community we therefore
    // grant every new user full super-admin access, mirroring the initial
    // setup account, so additional users can actually manage the platform.
    // Enterprise leaves the grant out: scoped roles are assigned separately
    // through the RBAC picker. A fail-closed license (orchestrator
    // unreachable) is treated as Community, consistent with the rest of the app.
    const license = await getServerLicense()
    const grantSuperAdmin = !license.enterprise

    await prisma.$transaction([
      prisma.user.create({
        data: {
          id,
          email: normalisedEmail,
          password: hashedPassword,
          name: name || null,
          role: grantSuperAdmin ? "super_admin" : "user",
          authProvider: "credentials",
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
      }),
      ...initialTenantIds.map((tid, idx) =>
        prisma.userTenant.create({
          data: {
            userId: id,
            tenantId: tid,
            isDefault: idx === 0,
            joinedAt: now,
          },
        })
      ),
      ...(grantSuperAdmin
        ? [
            prisma.rbacUserRole.create({
              data: {
                id: nanoid(),
                userId: id,
                roleId: "role_super_admin",
                scopeType: "global",
                scopeTarget: null,
                tenantId: DEFAULT_TENANT_ID,
                grantedAt: now,
              },
            }),
          ]
        : []),
    ])

    // Audit
    const { audit } = await import("@/lib/audit")
    await audit({
      action: "create",
      category: "users",
      resourceType: "user",
      resourceId: id,
      resourceName: normalisedEmail,
      details: { name: name || null, superAdminGranted: grantSuperAdmin },
      status: "success",
    })

    return NextResponse.json({
      success: true,
      data: {
        id,
        email: normalisedEmail,
        name: name || null,
        auth_provider: "credentials",
        enabled: 1,
        created_at: now.toISOString(),
      },
    })
  } catch (error: any) {
    console.error("Erreur POST users:", error)
    return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}
