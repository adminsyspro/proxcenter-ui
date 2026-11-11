// src/lib/rbac/serviceDesk.ts
//
// Service-desk assignments (ui#1336): one provider user, one service-desk
// role, many customer tenants. The assignment is stored once
// (rbac_service_desk_assignments) and materialised as what the rest of the
// application already understands, per target tenant:
//
//   - a membership (user_tenants), so the tenant shows in the switcher and
//     getCurrentTenantId lets the session in;
//   - an RBAC row "sd_<assignment id>_<tenant id>" (rbac_user_roles), so the
//     grant loader needs no second code path.
//
// The target set is recomputed from the source of truth whenever something it
// depends on changes: the assignment, the role's publication, a new tenant. The
// grant loader also checks the publication on every request
// (rolePublication.isRoleAvailableInTenant), so a lagging row never outlives
// an unpublication.

import { prisma } from "@/lib/db/prisma"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import { buildTenantCeiling } from "./rolePublication"

/** Id prefix of the RBAC rows this module owns. */
export const SERVICE_DESK_ROW_PREFIX = "sd_"

export function serviceDeskRowId(assignmentId: string, tenantId: string): string {
  return `${SERVICE_DESK_ROW_PREFIX}${assignmentId}_${tenantId}`
}

export function isServiceDeskRowId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(SERVICE_DESK_ROW_PREFIX)
}

export type ServiceDeskTargetInput = {
  assignment: { allTenants: boolean; tenantIds: string[]; expiresAt: Date | null }
  role: { audience: string | null; publishAll: boolean; publications: { tenantId: string }[] }
  /** Enabled customer tenants (the provider tenant excluded by the caller or here). */
  customerTenantIds: string[]
  now: Date
}

/**
 * The customer tenants an assignment reaches right now: the role's publication
 * (every customer tenant when published to all), narrowed by the assignment's
 * own list unless it follows the publication. An expired assignment, or a role
 * that is no longer a service-desk role, reaches nothing.
 */
export function computeServiceDeskTargets(input: ServiceDeskTargetInput): string[] {
  const { assignment, role, customerTenantIds, now } = input
  if (role.audience !== "service_desk") return []
  if (assignment.expiresAt !== null && assignment.expiresAt <= now) return []
  const customers = customerTenantIds.filter(id => id !== DEFAULT_TENANT_ID)
  const published = role.publishAll
    ? customers
    : customers.filter(id => role.publications.some(p => p.tenantId === id))
  if (assignment.allTenants) return published
  const wanted = new Set(assignment.tenantIds)
  return published.filter(id => wanted.has(id))
}

async function enabledCustomerTenantIds(): Promise<string[]> {
  const rows = await prisma.tenant.findMany({
    where: { enabled: true, id: { not: DEFAULT_TENANT_ID } },
    select: { id: true },
  })
  return rows.map(r => r.id)
}

/** A membership created here is the user's landing tenant only when they have none. */
async function ensureMembership(userId: string, tenantId: string, now: Date): Promise<void> {
  const existing = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { userId: true },
  })
  if (existing) return
  const hasDefault = await prisma.userTenant.findFirst({ where: { userId, isDefault: true }, select: { userId: true } })
  await prisma.userTenant.create({ data: { userId, tenantId, isDefault: !hasDefault, joinedAt: now } })
}

/**
 * Drop a membership the user no longer has any grant behind. Super admins are
 * members of every tenant by design and keep theirs; the last membership is
 * kept too (it grants nothing without a role).
 */
async function releaseMembership(userId: string, tenantId: string, now: Date): Promise<void> {
  const active = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
  const [roleRow, permRow, superAdmin] = await Promise.all([
    prisma.rbacUserRole.findFirst({ where: { userId, tenantId, ...active }, select: { id: true } }),
    prisma.rbacUserPermission.findFirst({ where: { userId, tenantId, ...active }, select: { id: true } }),
    prisma.rbacUserRole.findFirst({ where: { userId, roleId: "role_super_admin", ...active }, select: { id: true } }),
  ])
  if (roleRow || permRow || superAdmin) return
  const membership = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { isDefault: true },
  })
  if (!membership) return
  const replacement = await prisma.userTenant.findFirst({
    where: { userId, tenantId: { not: tenantId } },
    orderBy: { joinedAt: "asc" },
    select: { tenantId: true },
  })
  if (!replacement) return
  await prisma.$transaction(async tx => {
    await tx.userTenant.delete({ where: { userId_tenantId: { userId, tenantId } } })
    if (membership.isDefault) {
      await tx.userTenant.update({
        where: { userId_tenantId: { userId, tenantId: replacement.tenantId } },
        data: { isDefault: true },
      })
    }
  })
}

export type ServiceDeskSyncResult = { added: string[]; removed: string[] }

/**
 * Run `fn` over `items` one after the other. Memberships of one user depend on
 * each other (the first one created becomes the landing tenant, the default
 * moves when one is dropped), so these steps must not run concurrently.
 */
async function inSequence<T>(items: readonly T[], fn: (item: T) => Promise<void>, index = 0): Promise<void> {
  if (index >= items.length) return
  await fn(items[index])
  return inSequence(items, fn, index + 1)
}

/**
 * Make the materialised rows and memberships of one assignment match its
 * current target set. Idempotent. A missing assignment (deleted) removes
 * every row it owned.
 */
export async function syncServiceDeskAssignment(
  assignmentId: string,
  opts: { now?: Date; customerTenantIds?: string[] } = {},
): Promise<ServiceDeskSyncResult> {
  const now = opts.now ?? new Date()
  const assignment = await prisma.rbacServiceDeskAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      userId: true,
      roleId: true,
      allTenants: true,
      tenantIds: true,
      grantedById: true,
      grantedAt: true,
      expiresAt: true,
      role: { select: { audience: true, publishAll: true, publications: { select: { tenantId: true } } } },
    },
  })

  const prefix = `${SERVICE_DESK_ROW_PREFIX}${assignmentId}_`
  const existingRows = await prisma.rbacUserRole.findMany({
    where: { id: { startsWith: prefix } },
    select: { id: true, tenantId: true, userId: true },
  })

  const targets = assignment
    ? computeServiceDeskTargets({
        assignment: { allTenants: assignment.allTenants, tenantIds: assignment.tenantIds ?? [], expiresAt: assignment.expiresAt },
        role: assignment.role,
        customerTenantIds: opts.customerTenantIds ?? (await enabledCustomerTenantIds()),
        now,
      })
    : []
  const targetSet = new Set(targets)
  const existingByTenant = new Map(existingRows.map(r => [r.tenantId, r]))

  const added: string[] = []
  if (assignment) {
    await inSequence(targets, async tenantId => {
      await ensureMembership(assignment.userId, tenantId, now)
      const id = serviceDeskRowId(assignment.id, tenantId)
      if (existingByTenant.has(tenantId)) {
        await prisma.rbacUserRole.update({
          where: { id },
          data: { roleId: assignment.roleId, expiresAt: assignment.expiresAt },
        })
        return
      }
      await prisma.rbacUserRole.create({
        data: {
          id,
          userId: assignment.userId,
          roleId: assignment.roleId,
          scopeType: "inherit",
          scopeTarget: null,
          tenantId,
          grantedById: assignment.grantedById,
          grantedAt: assignment.grantedAt,
          expiresAt: assignment.expiresAt,
        },
      })
      added.push(tenantId)
    })
  }

  const removed: string[] = []
  const stale = existingRows.filter(row => !targetSet.has(row.tenantId))
  await inSequence(stale, async row => {
    await prisma.rbacUserRole.delete({ where: { id: row.id } })
    await releaseMembership(row.userId, row.tenantId, now)
    removed.push(row.tenantId)
  })

  return { added, removed }
}

/** Re-sync every assignment of a role (its publication changed). One user per assignment, so they run side by side. */
export async function syncServiceDeskForRole(roleId: string): Promise<ServiceDeskSyncResult> {
  const customerTenantIds = await enabledCustomerTenantIds()
  const assignments = await prisma.rbacServiceDeskAssignment.findMany({ where: { roleId }, select: { id: true } })
  const results = await Promise.all(assignments.map(a => syncServiceDeskAssignment(a.id, { customerTenantIds })))
  return {
    added: results.flatMap(r => r.added),
    removed: results.flatMap(r => r.removed),
  }
}

/**
 * A tenant was created or enabled: assignments of roles published to all
 * tenants reach it. A user may hold several such assignments, hence in sequence.
 */
export async function syncServiceDeskForNewTenant(): Promise<void> {
  const customerTenantIds = await enabledCustomerTenantIds()
  const assignments = await prisma.rbacServiceDeskAssignment.findMany({
    where: { allTenants: true, role: { audience: "service_desk", publishAll: true } },
    select: { id: true },
  })
  await inSequence(assignments, async a => {
    await syncServiceDeskAssignment(a.id, { customerTenantIds })
  })
}

/**
 * The permission ceiling of published roles, read from the seeded Tenant Admin
 * role so both stay in step.
 */
export async function loadTenantCeiling(): Promise<Set<string>> {
  const rows = await prisma.rbacRolePermission.findMany({
    where: { roleId: "role_tenant_admin" },
    select: { permission: { select: { name: true } } },
  })
  return buildTenantCeiling(rows.map(r => r.permission.name))
}

/**
 * The assignments a publication change would revoke, as (tenant, count) pairs:
 * ordinary rows of the role in tenants that leave the publication, and
 * service-desk rows likewise.
 */
export async function assignmentsRevokedByPublication(
  roleId: string,
  keptTenantIds: Set<string> | "all",
): Promise<{ tenantId: string; tenantName: string; count: number }[]> {
  if (keptTenantIds === "all") return []
  const rows = await prisma.rbacUserRole.groupBy({
    by: ["tenantId"],
    where: { roleId, tenantId: { not: DEFAULT_TENANT_ID } },
    _count: { _all: true },
  })
  const lost = rows.filter(r => !keptTenantIds.has(r.tenantId))
  if (lost.length === 0) return []
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: lost.map(r => r.tenantId) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(tenants.map(t => [t.id, t.name]))
  return lost
    .map(r => ({ tenantId: r.tenantId, tenantName: nameById.get(r.tenantId) ?? r.tenantId, count: r._count._all }))
    .sort((a, b) => a.tenantName.localeCompare(b.tenantName))
}

// FLAT on purpose, as PublicationParse.
export type ServiceDeskTargetCheck = { ok: boolean; error?: string; allTenants?: boolean; tenantIds?: string[] }

/**
 * Validate the tenant target of a service-desk assignment: "all tenants the
 * role is published to", or a list that can only narrow the publication.
 */
export function parseServiceDeskTarget(
  body: { all_tenants?: unknown; tenant_ids?: unknown },
  role: { publishAll: boolean; publications: { tenantId: string }[] },
  customerTenantIds: string[],
): ServiceDeskTargetCheck {
  const allTenants = body.all_tenants !== false
  if (allTenants) return { ok: true, allTenants, tenantIds: [] }
  if (!Array.isArray(body.tenant_ids)) return { ok: false, error: "tenant_ids must be a list of tenant ids" }
  const tenantIds = Array.from(new Set(body.tenant_ids.filter((t): t is string => typeof t === "string" && t.length > 0)))
  if (tenantIds.length === 0) return { ok: false, error: "Select at least one tenant" }
  const reachable = new Set(
    role.publishAll ? customerTenantIds : role.publications.map(p => p.tenantId).filter(id => customerTenantIds.includes(id)),
  )
  const outside = tenantIds.filter(id => !reachable.has(id))
  if (outside.length > 0) return { ok: false, error: `The role is not published to: ${outside.join(", ")}` }
  return { ok: true, allTenants, tenantIds: tenantIds.sort((a, b) => a.localeCompare(b)) }
}

/** The enabled customer tenants, for the route-side checks. */
export async function listCustomerTenantIds(): Promise<string[]> {
  return enabledCustomerTenantIds()
}

/**
 * Whether a user is a provider service-desk account: it holds a service-desk
 * assignment, or a row on a service-desk role (the provider's SSO group
 * mapping grants those as `oidc_` rows). A customer tenant can see such an
 * account among its members but never change, revoke or delete it (ui#1336).
 */
export async function isServiceDeskAccount(userId: string): Promise<boolean> {
  const [assignment, row] = await Promise.all([
    prisma.rbacServiceDeskAssignment.findFirst({ where: { userId }, select: { id: true } }),
    prisma.rbacUserRole.findFirst({ where: { userId, role: { audience: "service_desk" } }, select: { id: true } }),
  ])
  return !!assignment || !!row
}

/**
 * Whether a role row is the provider service desk's, hence read-only to the
 * caller: a service-desk assignment's row for everyone (it follows its
 * assignment), and any row on a service-desk role for a customer tenant (a
 * customer tenant can never assign such a role, so the provider granted it).
 */
export function isServiceDeskManaged(
  row: { id: string; role?: { audience?: string | null } | null },
  callerTenantId: string,
): boolean {
  if (isServiceDeskRowId(row.id)) return true
  return callerTenantId !== DEFAULT_TENANT_ID && row.role?.audience === "service_desk"
}

/** The 403 a customer tenant gets when it tries to change a service-desk account or its grants. */
export const SERVICE_DESK_ACCOUNT_ERROR = {
  error: "This is a provider service desk account; it is managed by the provider",
  code: "SERVICE_DESK_ACCOUNT",
} as const
