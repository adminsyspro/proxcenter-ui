// src/lib/tenant/index.ts
// Multi-tenancy helpers
//
// All reads/writes for `tenants`, `users`, `user_tenants` and the RBAC tables
// touched here go through Prisma (Postgres). `isSuperAdminLocal` is inlined
// (instead of importing from lib/rbac) to avoid a circular import — lib/rbac
// re-imports DEFAULT_TENANT_ID from this file.

import { getServerSession } from "next-auth"
import type { Prisma } from "@prisma/client"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

import { DEFAULT_TENANT_ID } from "./constants"
export { DEFAULT_TENANT_ID }

export interface Tenant {
  id: string
  slug: string
  name: string
  description: string | null
  enabled: boolean
  operatingModel: string | null
  settings: Record<string, any> | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

function rowToTenant(row: {
  id: string
  slug: string
  name: string
  description: string | null
  enabled: boolean
  operatingModel: string | null
  settings: Prisma.JsonValue | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    operatingModel: row.operatingModel,
    settings:
      row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
        ? (row.settings as Record<string, any>)
        : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Get current tenant ID from the session JWT.
 * Falls back to 'default' if not set (backwards-compatible).
 */
export async function getCurrentTenantId(): Promise<string> {
  const session = await getServerSession(authOptions)
  const tenantId = (session as any)?.user?.tenantId || DEFAULT_TENANT_ID

  // Verify tenant exists and is enabled
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, enabled: true },
  })

  if (!tenant) return DEFAULT_TENANT_ID
  if (!tenant.enabled) return DEFAULT_TENANT_ID

  // Verify the user actually belongs to this tenant (guards against stale JWTs)
  const userId = (session as any)?.user?.id
  if (userId && tenantId !== DEFAULT_TENANT_ID) {
    const allowed = await userHasAccessToTenant(userId, tenantId)
    if (!allowed) return DEFAULT_TENANT_ID
  }

  return tenantId
}

/**
 * Get tenants accessible by a user.
 * Super admins see all enabled tenants; regular users see only those they are members of.
 */
export async function getUserTenants(userId: string): Promise<Tenant[]> {
  if (await isSuperAdminLocal(userId)) {
    const all = await prisma.tenant.findMany({
      where: { enabled: true },
      orderBy: [{ id: "asc" }, { name: "asc" }],
    })
    // Prisma can't express "default first" in orderBy; do it client-side.
    return all
      .map(rowToTenant)
      .sort((a, b) => {
        if (a.id === DEFAULT_TENANT_ID && b.id !== DEFAULT_TENANT_ID) return -1
        if (b.id === DEFAULT_TENANT_ID && a.id !== DEFAULT_TENANT_ID) return 1
        return a.name.localeCompare(b.name)
      })
  }

  const memberships = await prisma.userTenant.findMany({
    where: { userId, tenant: { enabled: true } },
    include: { tenant: true },
    orderBy: [{ isDefault: "desc" }],
  })
  return memberships
    .map(m => rowToTenant(m.tenant))
    // Stable secondary sort by name; the Prisma orderBy only guarantees the
    // is_default ordering primary, names are post-sorted client-side.
    .sort((a, b) => {
      const aDefault = memberships.find(m => m.tenantId === a.id)?.isDefault ?? false
      const bDefault = memberships.find(m => m.tenantId === b.id)?.isDefault ?? false
      if (aDefault !== bDefault) return aDefault ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/**
 * Get user's default tenant ID.
 */
export async function getUserDefaultTenantId(userId: string): Promise<string> {
  const row = await prisma.userTenant.findFirst({
    where: { userId, isDefault: true },
    select: { tenantId: true },
  })
  return row?.tenantId || DEFAULT_TENANT_ID
}

/**
 * Check if a user holds role_super_admin on any tenant. Super admins have
 * cross-tenant access by design. Inlined here (instead of importing from
 * lib/rbac) to avoid a circular import — lib/rbac depends on
 * DEFAULT_TENANT_ID from this file.
 */
async function isSuperAdminLocal(userId: string): Promise<boolean> {
  const row = await prisma.rbacUserRole.findFirst({
    where: {
      userId,
      roleId: "role_super_admin",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  })
  return !!row
}

/**
 * Check if a user has access to a specific tenant.
 * Super admins always have access to every tenant.
 */
export async function userHasAccessToTenant(userId: string, tenantId: string): Promise<boolean> {
  if (await isSuperAdminLocal(userId)) return true
  const row = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { userId: true },
  })
  return !!row
}

/**
 * Create a tenant-scoped Prisma client using $extends.
 * Automatically filters all queries by tenantId and sets tenantId on creates.
 */
export function getTenantPrisma(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ args, query }: any) {
          args.where = { ...args.where, tenantId }
          return query(args)
        },
        async findFirst({ args, query }: any) {
          args.where = { ...args.where, tenantId }
          return query(args)
        },
        async findUnique({ args, query }: any) {
          // findUnique uses unique fields, so we verify after fetch.
          // If a select clause is used that omits tenantId, we need to
          // temporarily include it for the tenant check, then strip it.
          const hadSelect = !!args.select
          const selectedTenantId = hadSelect && args.select.tenantId

          if (hadSelect && !selectedTenantId) {
            args.select = { ...args.select, tenantId: true }
          }

          const result = await query(args)

          if (result && (result as any).tenantId !== tenantId) return null

          // Strip tenantId from result if it wasn't originally selected
          if (result && hadSelect && !selectedTenantId) {
            delete (result as any).tenantId
          }

          return result
        },
        async create({ args, query }: any) {
          args.data = { ...args.data, tenantId }
          return query(args)
        },
        async createMany({ args, query }: any) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => ({ ...d, tenantId }))
          } else {
            args.data = { ...args.data, tenantId }
          }
          return query(args)
        },
        async update({ model, args, query }: any) {
          // Verify ownership before updating via the base prisma client
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1)
          const check = await (prisma as any)[modelKey].findUnique({
            where: args.where,
            select: { tenantId: true },
          })
          if (!check || check.tenantId !== tenantId) {
            throw new Error('Record not found')
          }
          return query(args)
        },
        async updateMany({ args, query }: any) {
          args.where = { ...args.where, tenantId }
          return query(args)
        },
        async delete({ model, args, query }: any) {
          // Verify ownership before deleting via the base prisma client
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1)
          const check = await (prisma as any)[modelKey].findUnique({
            where: args.where,
            select: { tenantId: true },
          })
          if (!check || check.tenantId !== tenantId) {
            throw new Error('Record not found')
          }
          return query(args)
        },
        async deleteMany({ args, query }: any) {
          args.where = { ...args.where, tenantId }
          return query(args)
        },
        async upsert({ model, args, query }: any) {
          // Inject tenantId into create data and strip it from update to prevent tenant reassignment
          args.create = { ...args.create, tenantId }
          const { tenantId: _stripTenantId, ...safeUpdate } = args.update || {}
          args.update = safeUpdate
          // Check if record already exists and verify tenant ownership
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1)
          const existing = await (prisma as any)[modelKey].findUnique({
            where: args.where,
            select: { tenantId: true },
          })
          if (existing && existing.tenantId !== tenantId) {
            throw new Error('Record not found')
          }
          return query(args)
        },
        async count({ args, query }: any) {
          args.where = { ...args.where, tenantId }
          return query(args)
        },
        async aggregate({ args, query }: any) {
          args.where = { ...args.where, tenantId }
          return query(args)
        },
        async groupBy({ args, query }: any) {
          args.where = { ...args.where, tenantId }
          return query(args)
        },
      },
    },
  })
}

/**
 * Get a tenant-scoped Prisma client from the current session.
 * Convenience wrapper for API routes.
 */
export async function getSessionPrisma() {
  const tenantId = await getCurrentTenantId()
  return getTenantPrisma(tenantId)
}

/**
 * Get the set of connection IDs reachable by the current tenant.
 *
 * Includes BOTH:
 *  - connections owned directly via the `Connection` table (legacy
 *    multi-tenancy or provider tenant)
 *  - PVE & PBS connection IDs referenced by the tenant's vDC bindings
 *    (MSP/IaaS mode, where the provider owns the connection but exposes
 *    a slice via vDC)
 *
 * Without the vDC union, tenants in MSP mode would get an empty set and
 * any orchestrator-proxy filter built on top of this helper would drop
 * every event (changes feed, replication plans, rolling updates, DRS
 * migration checks, …). Provider tenant returns all owned connections;
 * getVdcScope returns null for them so no extra union happens.
 */
export async function getTenantConnectionIds(): Promise<Set<string>> {
  const tenantId = await getCurrentTenantId()

  // Provider / NOC sees the whole fleet, including MSP-tenant-owned
  // connections. The session client scopes to tenant_id='default' (pool
  // only), so enumerate every connection with the global client instead.
  if (tenantId === DEFAULT_TENANT_ID) {
    const all = await prisma.connection.findMany({ select: { id: true } })
    return new Set(all.map((c: any) => c.id))
  }

  // MSP tenants own their connections directly (the session client returns
  // them). IaaS tenants own none directly but reach provider-pool PVE/PBS
  // connections via their vDC bindings, so union those in.
  const tenantPrisma = await getSessionPrisma()
  const connections = await tenantPrisma.connection.findMany({ select: { id: true } })
  const ids = new Set(connections.map((c: any) => c.id))

  // Union with vDC bindings: PVE under .connectionIds, PBS under
  // .pbsConnectionIds. Imported lazily to keep the dependency direction
  // tenant -> vdc only at call time (vdc/scope.ts depends on this module
  // for DEFAULT_TENANT_ID, so a top-level import would cycle).
  const { getVdcScope } = await import('@/lib/vdc/scope')
  const scope = await getVdcScope(tenantId)
  if (scope) {
    for (const cid of scope.connectionIds) ids.add(cid)
    for (const cid of scope.pbsConnectionIds) ids.add(cid)
  }

  return ids
}

/**
 * Verify a connection ID is reachable by the current tenant: either it
 * belongs to the tenant directly, OR the tenant has a vDC binding that
 * references it (PVE via vdcs.connection_id, PBS via vdc_pbs_namespaces).
 * Returns a 404 NextResponse if neither, or null if OK.
 */
export async function verifyConnectionOwnership(connectionId: string): Promise<Response | null> {
  const tenantConnectionIds = await getTenantConnectionIds()
  if (tenantConnectionIds.has(connectionId)) return null
  // Fall back to vDC scope so vDC tenants can reach provider-owned PVE/PBS
  // referenced by their bindings (mirror of the bypass used by getConnectionById).
  const { getVdcScope } = await import('@/lib/vdc/scope')
  const scope = await getVdcScope(await getCurrentTenantId())
  if (scope && (scope.connectionIds.has(connectionId) || scope.pbsConnectionIds.has(connectionId))) {
    return null
  }
  const { NextResponse } = await import('next/server')
  return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
}

/**
 * Enforce that the current session is operating in the provider tenant.
 * Used to scope provider-level operations (tenant CRUD, vDC admin, provider-bridges).
 * Returns a 403 NextResponse if not in the provider tenant, or null if OK.
 */
export async function requireProviderTenant(): Promise<Response | null> {
  const tenantId = await getCurrentTenantId()
  if (tenantId !== DEFAULT_TENANT_ID) {
    const { NextResponse } = await import('next/server')
    return NextResponse.json(
      { error: 'This operation is only available from the provider tenant' },
      { status: 403 }
    )
  }
  return null
}

/**
 * List all tenants (admin only).
 */
export async function listTenants(): Promise<Tenant[]> {
  const rows = await prisma.tenant.findMany({ orderBy: { name: "asc" } })
  return rows.map(rowToTenant)
}

/**
 * Create a new tenant.
 */
export async function createTenant(data: {
  slug: string
  name: string
  description?: string
  createdBy?: string
  operatingModel?: 'iaas' | 'msp'
}): Promise<Tenant> {
  const id = crypto.randomUUID()
  const now = new Date()
  const row = await prisma.tenant.create({
    data: {
      id,
      slug: data.slug,
      name: data.name,
      description: data.description || null,
      enabled: true,
      // v1.5: non-default tenants need operating_model (DB CHECK); default to iaas.
      operatingModel: data.operatingModel ?? 'iaas',
      createdBy: data.createdBy || null,
      createdAt: now,
      updatedAt: now,
    },
  })

  // Super admins always have access to every tenant. Attach them on
  // create so the new tenant doesn't need a manual provisioning step,
  // and pair with the SUPER_ADMIN_PROTECTED guard in
  // removeUserFromTenant so a super-admin can never be stripped out.
  // The first super-admin landing in a fresh tenant gets isDefault=true
  // only if they don't already have a default elsewhere; this preserves
  // the existing landing-tenant behaviour on login.
  const superAdminRows = await prisma.rbacUserRole.findMany({
    where: {
      roleId: "role_super_admin",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { userId: true },
    distinct: ["userId"],
  })
  if (superAdminRows.length > 0) {
    await prisma.userTenant.createMany({
      data: superAdminRows.map(r => ({
        userId: r.userId,
        tenantId: id,
        isDefault: false,
        joinedAt: now,
      })),
      skipDuplicates: true,
    })
  }

  return rowToTenant(row)
}

/**
 * Update a tenant.
 */
export async function updateTenant(
  id: string,
  data: { name?: string; slug?: string; description?: string; enabled?: boolean },
): Promise<Tenant | null> {
  const existing = await prisma.tenant.findUnique({ where: { id } })
  if (!existing) return null

  const row = await prisma.tenant.update({
    where: { id },
    data: {
      name: data.name ?? existing.name,
      slug: data.slug ?? existing.slug,
      description: data.description ?? existing.description,
      enabled: data.enabled !== undefined ? data.enabled : existing.enabled,
      updatedAt: new Date(),
    },
  })
  return rowToTenant(row)
}

/**
 * Delete a tenant (cannot delete 'default').
 *
 * RbacUserRole.tenantId is a plain string column with no foreign-key relation
 * to Tenant (see schema.prisma), so Postgres won't cascade-clean role grants
 * when a tenant is dropped. Without this we leave orphan rows that surface in
 * /security/rbac as assignments under tenant UUIDs nobody can resolve. We
 * remove them in the same transaction as the tenant so a half-failed delete
 * either rolls back fully or leaves nothing dangling.
 */
export async function deleteTenant(id: string): Promise<boolean> {
  if (id === DEFAULT_TENANT_ID) return false

  const deleted = await prisma.$transaction(async tx => {
    await tx.rbacUserRole.deleteMany({ where: { tenantId: id } })
    const result = await tx.tenant.deleteMany({ where: { id, NOT: { id: "default" } } })
    return result.count > 0
  })

  return deleted
}

/**
 * Add a user to a tenant.
 * If isDefault is true, clears any existing is_default flag for the user.
 * If isDefault is false and the user has no existing default tenant yet, this
 * membership becomes the user's default automatically (so login lands here
 * instead of falling back to the provider tenant).
 */
export async function addUserToTenant(userId: string, tenantId: string, isDefault = false): Promise<void> {
  const now = new Date()

  await prisma.$transaction(async tx => {
    let markDefault = isDefault
    if (!markDefault) {
      const existingDefault = await tx.userTenant.findFirst({
        where: { userId, isDefault: true },
        select: { userId: true },
      })
      if (!existingDefault) markDefault = true
    }

    if (markDefault) {
      await tx.userTenant.updateMany({
        where: { userId },
        data: { isDefault: false },
      })
    }

    // Mirrors the legacy `INSERT OR IGNORE`: keep the existing membership row
    // intact (especially the joined_at + isDefault values already in DB) when
    // it's already there.
    const existing = await tx.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    })
    if (!existing) {
      await tx.userTenant.create({
        data: {
          userId,
          tenantId,
          isDefault: markDefault,
          joinedAt: now,
        },
      })
    } else if (markDefault && !existing.isDefault) {
      // Promote the already-existing membership to default.
      await tx.userTenant.update({
        where: { userId_tenantId: { userId, tenantId } },
        data: { isDefault: true },
      })
    }
  })
}

export class TenantMembershipError extends Error {
  constructor(
    message: string,
    public readonly code: "LAST_TENANT" | "NOT_A_MEMBER" | "SUPER_ADMIN_PROTECTED",
  ) {
    super(message)
    this.name = "TenantMembershipError"
  }
}

/**
 * Remove a user from a tenant.
 * Refuses to strip the user's last membership (would orphan them).
 * Refuses to strip a super-admin from any tenant: super_admins have
 * cross-tenant access by design and createTenant always attaches them.
 * Cleans up role and direct-permission assignments scoped to the removed tenant.
 * If the removed membership was the user's default, transfers the default flag
 * to another of their memberships (oldest join first).
 */
export async function removeUserFromTenant(userId: string, tenantId: string): Promise<void> {
  const existing = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { isDefault: true },
  })
  if (!existing) {
    throw new TenantMembershipError("User is not a member of this tenant", "NOT_A_MEMBER")
  }

  // Super admins are pinned to every tenant by design (createTenant
  // attaches them automatically). Removing them would either re-orphan
  // them on the next createTenant cycle, or create a UI inconsistency
  // where a super-admin appears partially attached.
  const isSuperAdmin = await prisma.rbacUserRole.findFirst({
    where: {
      userId,
      roleId: "role_super_admin",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  })
  if (isSuperAdmin) {
    throw new TenantMembershipError(
      "Super admins are members of every tenant by design and cannot be removed",
      "SUPER_ADMIN_PROTECTED",
    )
  }

  const replacement = await prisma.userTenant.findFirst({
    where: { userId, tenantId: { not: tenantId } },
    orderBy: { joinedAt: "asc" },
    select: { tenantId: true },
  })
  if (!replacement) {
    throw new TenantMembershipError(
      "Cannot remove the user's last tenant membership",
      "LAST_TENANT",
    )
  }

  await prisma.$transaction(async tx => {
    await tx.userTenant.delete({
      where: { userId_tenantId: { userId, tenantId } },
    })
    if (existing.isDefault) {
      await tx.userTenant.update({
        where: { userId_tenantId: { userId, tenantId: replacement.tenantId } },
        data: { isDefault: true },
      })
    }
    // Drop role and direct-permission grants scoped to the removed tenant.
    await tx.rbacUserRole.deleteMany({ where: { userId, tenantId } })
    await tx.rbacUserPermission.deleteMany({ where: { userId, tenantId } })
  })
}

/**
 * Get users in a tenant. Returns the legacy snake_case shape so existing
 * frontend code consuming `is_default` / `joined_at` keeps working. The
 * `is_super_admin` flag is derived from rbac_user_roles (source of truth)
 * and the UI uses it to hide the "remove from tenant" affordance — a
 * super-admin can't be stripped out (cf. removeUserFromTenant guard).
 */
export async function getTenantUsers(tenantId: string): Promise<
  Array<{
    id: string
    email: string
    name: string | null
    role: string
    enabled: boolean
    is_default: boolean
    is_super_admin: boolean
    joined_at: string
  }>
> {
  const memberships = await prisma.userTenant.findMany({
    where: { tenantId },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  })

  const userIds = memberships.map(m => m.userId)
  const superAdminRows = userIds.length > 0
    ? await prisma.rbacUserRole.findMany({
        where: {
          userId: { in: userIds },
          roleId: "role_super_admin",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { userId: true },
        distinct: ["userId"],
      })
    : []
  const superAdminIds = new Set(superAdminRows.map(r => r.userId))

  return memberships.map(m => ({
    id: m.user.id,
    email: m.user.email,
    name: m.user.name,
    role: m.user.role,
    enabled: m.user.enabled,
    is_default: m.isDefault,
    is_super_admin: superAdminIds.has(m.user.id),
    joined_at: m.joinedAt.toISOString(),
  }))
}
