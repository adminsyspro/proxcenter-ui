// src/lib/rbac/index.ts
// RBAC helper functions for permission checking (Postgres / Prisma).
//
// All DB-touching helpers are async — they query Postgres via Prisma. The
// previous SQLite raw-SQL implementation was migrated in step 2.2 of the
// SQLite → Postgres sprint; cross-DB workarounds (PROTECTED_ROLE_ID_LIST_SQL,
// the SQLite-only isSuperAdminLocal in lib/tenant) were removed at the same
// time.

import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { getPrincipal, rejectionToResponse, type Principal } from "@/lib/auth/principal"
import { resolveVmMeta } from "@/lib/cache/vmMetaCache"
import { getTenantInventoriesFromCache } from "@/lib/cache/inventoryCache"
import { DEFAULT_TENANT_ID } from "@/lib/tenant"
import {
  deriveRbacInfraScope,
  isConnectionVisible,
  mayHaveVisibleGuests,
  applyRbacInfraFilter,
  filterVisibleConnections,
  filterCandidateConnections,
  pruneEmptyConnections,
  tokenInfraScope,
  type RbacInfraScope,
} from './infraScope'

export {
  isConnectionVisible,
  mayHaveVisibleGuests,
  applyRbacInfraFilter,
  filterVisibleConnections,
  filterCandidateConnections,
  pruneEmptyConnections,
  type RbacInfraScope,
}

export interface PermissionCheck {
  userId: string
  permission: string
  resourceType?: "connection" | "node" | "vm" | "global" | "pbs"
  resourceId?: string
  resourceMeta?: { tags?: string[]; pool?: string }
  tenantId?: string
}

/**
 * Filter fragment matching grants whose expiry is either NULL or strictly
 * in the future. Equivalent to the SQLite `expires_at IS NULL OR expires_at > datetime('now')`.
 */
function activeGrantFilter() {
  return {
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  }
}

/**
 * The user's full set of grants for a tenant, loaded in two Prisma queries
 * regardless of how many resources we need to check against. Replaces the
 * previous per-element `hasPermission` round trips that put `filterVmsBy*`
 * at O(N) DB calls — now O(1) per call, with the matching done in memory.
 *
 * `byScope` groups all grants by (scopeType, scopeTarget) so a single
 * (e.g.) "node:src:n1" entry carries every permission the user has at that
 * scope, regardless of whether it came from a role or a direct grant.
 */
type LoadedGrants = {
  superAdmin: boolean
  byScope: Array<{
    scopeType: string
    scopeTarget: string | null
    permissions: Set<string>
  }>
}

/**
 * Sentinel `scopeType` on an assignment meaning "follow the role's default
 * scope". It is never stored on a role's `defaultScopes` and is expanded away
 * before any `scopeMatches` call, so the matcher only ever sees real scopes.
 */
export const INHERIT_SCOPE = "inherit"

type ScopeEntry = { scopeType: string; scopeTarget: string | null }

/**
 * Resolve an assignment's effective scopes (issue #383). An assignment whose
 * scopeType is "inherit" follows the role's `defaultScopes`, or `global` when
 * the role has none. Any explicit scope overrides the role default for that
 * single assignment. Pure, no DB. Malformed default entries (missing or blank
 * scopeType) are dropped so a bad role row can never silently widen access.
 */
export function resolveEffectiveScopes(
  scopeType: string,
  scopeTarget: string | null,
  roleDefaultScopes: ScopeEntry[] | null | undefined,
): ScopeEntry[] {
  if (scopeType !== INHERIT_SCOPE) {
    return [{ scopeType, scopeTarget: scopeTarget ?? null }]
  }
  const defaults = (Array.isArray(roleDefaultScopes) ? roleDefaultScopes : [])
    .filter(
      (s): s is ScopeEntry =>
        !!s && typeof s.scopeType === "string" && s.scopeType.length > 0,
    )
    .map(s => ({ scopeType: s.scopeType, scopeTarget: s.scopeTarget ?? null }))
  return defaults.length ? defaults : [{ scopeType: "global", scopeTarget: null }]
}

async function loadUserGrants(userId: string, tenantId: string): Promise<LoadedGrants> {
  // Super admins short-circuit: the role grants global, cross-tenant access
  // and we never need to enumerate scopes for them.
  if (await isUserSuperAdmin(userId)) {
    return { superAdmin: true, byScope: [] }
  }

  // One round trip for role-derived grants (with the role's permissions
  // joined in), one for direct grants. Both are tenant-scoped + active.
  const [roleGrants, directGrants] = await Promise.all([
    prisma.rbacUserRole.findMany({
      where: { userId, tenantId, ...activeGrantFilter() },
      select: {
        scopeType: true,
        scopeTarget: true,
        role: {
          select: {
            defaultScopes: true,
            permissions: { select: { permission: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.rbacUserPermission.findMany({
      where: { userId, tenantId, ...activeGrantFilter() },
      select: {
        scopeType: true,
        scopeTarget: true,
        permission: { select: { name: true } },
      },
    }),
  ])

  // Group every grant by its (scopeType, scopeTarget) key. A null target
  // (typical for global / tenant-wide scopes) is folded into the same key
  // namespace using the empty string sentinel.
  const map = new Map<string, { scopeType: string; scopeTarget: string | null; permissions: Set<string> }>()
  const keyOf = (st: string, tgt: string | null) => `${st}:${tgt ?? ""}`
  const upsert = (scopeType: string, scopeTarget: string | null) => {
    const k = keyOf(scopeType, scopeTarget)
    let entry = map.get(k)
    if (!entry) {
      entry = { scopeType, scopeTarget, permissions: new Set<string>() }
      map.set(k, entry)
    }
    return entry
  }

  for (const r of roleGrants) {
    // "inherit" assignments expand into the role's default scopes (issue #383);
    // every other scope passes through unchanged. The role's permissions are
    // attached to each resolved scope entry.
    const effective = resolveEffectiveScopes(
      r.scopeType,
      r.scopeTarget,
      r.role.defaultScopes as ScopeEntry[] | null,
    )
    for (const s of effective) {
      const entry = upsert(s.scopeType, s.scopeTarget)
      for (const rp of r.role.permissions) {
        entry.permissions.add(rp.permission.name)
      }
    }
  }
  for (const d of directGrants) {
    upsert(d.scopeType, d.scopeTarget).permissions.add(d.permission.name)
  }

  return { superAdmin: false, byScope: Array.from(map.values()) }
}

/**
 * Sync predicate over preloaded grants. Equivalent to one `hasPermission`
 * check but with zero DB calls — meant to be invoked in a tight loop after
 * a single `loadUserGrants` call.
 */
function checkGrants(
  grants: LoadedGrants,
  permission: string,
  resourceType?: string,
  resourceId?: string,
  resourceMeta?: { tags?: string[]; pool?: string },
): boolean {
  if (grants.superAdmin) return true
  for (const g of grants.byScope) {
    if (!g.permissions.has(permission)) continue
    if (scopeMatches(g.scopeType, g.scopeTarget, resourceType, resourceId, resourceMeta)) {
      return true
    }
  }
  return false
}

/**
 * Check if a user has role_super_admin on ANY tenant.
 * role_super_admin is a global, cross-tenant privilege: a single assignment
 * (typically on the provider tenant) grants full access to all tenants.
 */
export async function isUserSuperAdmin(userId: string): Promise<boolean> {
  const row = await prisma.rbacUserRole.findFirst({
    where: { userId, roleId: "role_super_admin", ...activeGrantFilter() },
    select: { id: true },
  })
  return !!row
}

/**
 * Role IDs that must stay hidden from non-super-admin callers and may not be
 * assigned by anyone other than a super admin. Both grant wildcard permissions
 * (see seed in prisma/seed.ts); exposing either to a tenant admin lets them
 * escalate to full cluster access.
 */
export const PROTECTED_ROLE_IDS = ["role_super_admin", "role_provider_admin"] as const

/**
 * Roles meant for the provider tenant (or single-tenant Community installs)
 * and that grant `automation.view` (DRS / Site Recovery / Network Security /
 * Flows / Resources). Assigning them inside a non-default tenant unlocks
 * orchestration pages that Tenant Admin explicitly omits — see seed.ts where
 * role_tenant_admin's permission list comments why `automation.*` is dropped.
 *
 * Enforcement is twofold:
 *  - server-side: POST/PATCH /api/v1/rbac/assignments refuse to bind any of
 *    these to a tenantId other than `default` (see DEFAULT_TENANT_ID).
 *  - client-side: /security/rbac filters them out of the role dropdown when
 *    the target tenant isn't `default`.
 *
 * role_vm_user has no automation perms but stays here because it belongs to
 * the same legacy "global" role family — tenant operators should use the
 * tenant_* taxonomy (role_tenant_admin / role_tenant_operator /
 * role_tenant_viewer) which is the supported surface for vDC tenants.
 */
export const PROVIDER_ONLY_ROLE_IDS = [
  "role_operator",
  "role_vm_admin",
  "role_viewer",
  "role_vm_user",
] as const

/**
 * Check if a user holds any protected role (super_admin or provider_admin).
 * Use this (instead of isUserSuperAdmin) when deciding UI visibility of admin
 * accounts — a provider_admin has equivalent blast radius and deserves the
 * same hiding from tenant operators.
 */
export async function isUserProtected(userId: string): Promise<boolean> {
  const row = await prisma.rbacUserRole.findFirst({
    where: {
      userId,
      roleId: { in: [...PROTECTED_ROLE_IDS] },
      ...activeGrantFilter(),
    },
    select: { id: true },
  })
  return !!row
}

/**
 * Check if a user has a specific permission
 * @param check - The permission check parameters
 * @returns true if the user has the permission, false otherwise
 */
export async function hasPermission(check: PermissionCheck): Promise<boolean> {
  const { userId, permission, resourceType, resourceId, resourceMeta, tenantId } = check
  const tid = tenantId || DEFAULT_TENANT_ID
  const grants = await loadUserGrants(userId, tid)
  return checkGrants(grants, permission, resourceType, resourceId, resourceMeta)
}

/**
 * Shared prologue of the principal-aware helpers. A token principal short-
 * circuits into its flat scope permissions + connection perimeter (NEVER a
 * DB grant load: a token has no user row, loading grants would silently
 * return an empty set). Anything else resolves to the legacy userId path.
 */
function asTokenPrincipal(principalOrUserId: string | Principal): Principal | null {
  if (typeof principalOrUserId !== "string" && principalOrUserId.kind === "token") {
    return principalOrUserId
  }
  return null
}

function toUserId(principalOrUserId: string | Principal): string {
  return typeof principalOrUserId === "string"
    ? principalOrUserId
    : (principalOrUserId.userId as string)
}

/**
 * The tenant to load grants against (hard gate 2, Task 18). An explicit
 * `tenantId` argument always wins (existing behaviour for every plain-userId
 * caller, unchanged). When it is omitted, fall back to the tenant CARRIED BY
 * THE PRINCIPAL ITSELF rather than straight to `DEFAULT_TENANT_ID`: a
 * Principal already knows its own tenant, and defaulting past it would
 * silently evaluate every MSP user's grants against the provider tenant the
 * moment a caller passes a Principal without also repeating its tenantId.
 */
function resolveGrantTenantId(principalOrUserId: string | Principal, tenantId?: string): string {
  const principalTenantId = typeof principalOrUserId === "string" ? undefined : principalOrUserId.tenantId
  return tenantId || principalTenantId || DEFAULT_TENANT_ID
}

/**
 * Get all effective permissions for a user (or the flat scope set of a token)
 */
export async function getEffectivePermissions(
  principalOrUserId: string | Principal,
  resourceType?: string,
  resourceId?: string,
  tenantId?: string,
): Promise<string[]> {
  const token = asTokenPrincipal(principalOrUserId)
  if (token) {
    return Array.from(token.permissions ?? [])
  }
  const userId = toUserId(principalOrUserId)
  const tid = resolveGrantTenantId(principalOrUserId, tenantId)
  const grants = await loadUserGrants(userId, tid)

  // Super admins implicitly hold every defined permission. Return the full
  // catalogue rather than a hardcoded list so newly added permissions are
  // picked up automatically.
  if (grants.superAdmin) {
    const allPerms = await prisma.rbacPermission.findMany({ select: { name: true } })
    return allPerms.map(p => p.name)
  }

  const permissions = new Set<string>()
  for (const g of grants.byScope) {
    if (!scopeMatches(g.scopeType, g.scopeTarget, resourceType, resourceId)) continue
    for (const p of g.permissions) permissions.add(p)
  }
  return Array.from(permissions)
}

/**
 * Check if multiple permissions are granted
 */
export async function hasAllPermissions(
  userId: string,
  permissions: string[],
  resourceType?: string,
  resourceId?: string,
  tenantId?: string,
): Promise<boolean> {
  const tid = tenantId || DEFAULT_TENANT_ID
  const grants = await loadUserGrants(userId, tid)
  return permissions.every(p => checkGrants(grants, p, resourceType, resourceId))
}

/**
 * Check if at least one permission is granted
 */
export async function hasAnyPermission(
  userId: string,
  permissions: string[],
  resourceType?: string,
  resourceId?: string,
  tenantId?: string,
): Promise<boolean> {
  const tid = tenantId || DEFAULT_TENANT_ID
  const grants = await loadUserGrants(userId, tid)
  return permissions.some(p => checkGrants(grants, p, resourceType, resourceId))
}

/**
 * Get all resources a user can access with a specific permission
 */
export async function getAccessibleResources(
  userId: string,
  permission: string,
  tenantId?: string,
): Promise<{ scope_type: string; scope_target: string | null }[]> {
  const tid = tenantId || DEFAULT_TENANT_ID
  const grants = await loadUserGrants(userId, tid)

  if (grants.superAdmin) {
    return [{ scope_type: "global", scope_target: null }]
  }

  // Already deduped by (scopeType, scopeTarget) inside the loader; just keep
  // entries that grant the requested permission.
  return grants.byScope
    .filter(g => g.permissions.has(permission))
    .map(g => ({ scope_type: g.scopeType, scope_target: g.scopeTarget }))
}

// Helper function to check if a scope matches
function scopeMatches(
  scopeType: string,
  scopeTarget: string | null,
  resourceType?: string,
  resourceId?: string,
  resourceMeta?: { tags?: string[]; pool?: string }
): boolean {
  // Global scope matches everything
  if (scopeType === "global") {
    return true
  }

  // If no resource filter, include all scoped permissions
  if (!resourceType || !resourceId) {
    return true
  }

  switch (scopeType) {
    case "connection":
      // Connection scope matches if resourceId starts with the connection ID
      return resourceId.startsWith(scopeTarget || "")

    case "node":
      // Node scope matches if the resource is on this node
      // scopeTarget format: "connectionId:nodeName"
      // resourceId format for VM: "connectionId:nodeName:type:vmid"
      // resourceId format for node: "connectionId:nodeName"
      if (scopeTarget) {
        // Check if resourceId starts with the node scope target
        // This handles both node resources and VM resources on that node
        return resourceId.startsWith(scopeTarget + ":") || resourceId === scopeTarget
      }


return false

    case "vm":
      // VM scope matches exactly
      return resourceId === scopeTarget

    case "tag":
      if (!resourceMeta?.tags || !scopeTarget) return false
      return resourceMeta.tags.includes(scopeTarget)

    case "pool":
      if (!resourceMeta?.pool || !scopeTarget) return false
      return resourceMeta.pool === scopeTarget

    default:
      return false
  }
}

// Export permission constants
export const PERMISSIONS = {
  // VM
  VM_VIEW: "vm.view",
  VM_CONSOLE: "vm.console",
  VM_START: "vm.start",
  VM_STOP: "vm.stop",
  VM_RESTART: "vm.restart",
  VM_SUSPEND: "vm.suspend",
  VM_SNAPSHOT: "vm.snapshot",
  VM_BACKUP: "vm.backup",
  VM_CLONE: "vm.clone",
  VM_MIGRATE: "vm.migrate",
  VM_CONFIG: "vm.config",
  VM_DELETE: "vm.delete",
  VM_CREATE: "vm.create",

  // Storage
  STORAGE_VIEW: "storage.view",
  STORAGE_CONTENT: "storage.content",
  STORAGE_UPLOAD: "storage.upload",
  STORAGE_DELETE: "storage.delete",

  // Node
  NODE_VIEW: "node.view",
  NODE_CONSOLE: "node.console",
  NODE_SERVICES: "node.services",
  NODE_NETWORK: "node.network",
  NODE_MANAGE: "node.manage",

  // Connection
  CONNECTION_VIEW: "connection.view",
  CONNECTION_MANAGE: "connection.manage",

  // Backup
  BACKUP_VIEW: "backup.view",
  BACKUP_RESTORE: "backup.restore",
  BACKUP_DELETE: "backup.delete",

  // Backup Jobs (scheduled backups)
  BACKUP_JOB_VIEW: "backup.job.view",
  BACKUP_JOB_CREATE: "backup.job.create",
  BACKUP_JOB_EDIT: "backup.job.edit",
  BACKUP_JOB_DELETE: "backup.job.delete",
  BACKUP_JOB_RUN: "backup.job.run",

  // Automation (DRS, etc.)
  AUTOMATION_VIEW: "automation.view",
  AUTOMATION_MANAGE: "automation.manage",
  AUTOMATION_EXECUTE: "automation.execute",

  // Operations
  EVENTS_VIEW: "events.view",
  ALERTS_VIEW: "alerts.view",
  ALERTS_MANAGE: "alerts.manage",
  TASKS_VIEW: "tasks.view",
  REPORTS_VIEW: "reports.view",

  // Storage Admin
  STORAGE_ADMIN: "storage.admin",

  // Admin
  ADMIN_USERS: "admin.users",
  ADMIN_RBAC: "admin.rbac",
  ADMIN_SETTINGS: "admin.settings",
  ADMIN_AUDIT: "admin.audit",
  ADMIN_COMPLIANCE: "admin.compliance",
  ADMIN_TENANTS: "admin.tenants",
  ADMIN_APITOKENS: "admin.apitokens",
} as const

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS]

// ============================================================================
// API Route Helper Functions
// ============================================================================

/**
 * Build a VM resource ID from connection, node, type and vmid
 * Format: "connId:node:type:vmid"
 */
export function buildVmResourceId(connId: string, node: string, type: string, vmid: string): string {
  return `${connId}:${node}:${type}:${vmid}`
}

/**
 * Build a node resource ID from connection and node name
 * Format: "connId:nodeName"
 */
export function buildNodeResourceId(connId: string, nodeName: string): string {
  return `${connId}:${nodeName}`
}

/**
 * Get the current caller's RBAC context from the resolved principal
 * (session cookie or API token). Returns null if not authenticated.
 */
export async function getRBACContext(): Promise<{
  userId?: string
  isAdmin: boolean
  tenantId: string
  principal?: Principal
} | null> {
  const result = await getPrincipal()
  if (!result.ok || !result.principal) return null
  const principal = result.principal
  if (principal.kind === "token") {
    // A token is NEVER super admin and never carries a synthetic userId.
    return { isAdmin: false, tenantId: principal.tenantId, principal }
  }
  return {
    userId: principal.userId,
    isAdmin: await isUserSuperAdmin(principal.userId as string),
    tenantId: principal.tenantId,
    principal,
  }
}

/**
 * Check if a user has any tag or pool scoped assignments (roles or direct permissions).
 * Used to decide whether to attempt the second pass in checkPermission().
 */
export async function hasTagOrPoolScopes(userId: string, tenantId?: string): Promise<boolean> {
  const tid = tenantId || DEFAULT_TENANT_ID
  const grants = await loadUserGrants(userId, tid)
  // Super admins don't carry tag/pool scopes — they short-circuit at the
  // top of every permission check, so the second-pass logic that uses this
  // helper has no work to do for them.
  if (grants.superAdmin) return false
  return grants.byScope.some(g => g.scopeType === "tag" || g.scopeType === "pool")
}

function resolveTokenConnectionId(
  resourceType?: "connection" | "node" | "vm" | "global" | "pbs",
  resourceId?: string,
): string | null {
  if (!resourceType || !resourceId || resourceType === "global") return null
  // "connection" and "pbs" carry a RAW connection id; "node" and "vm" carry
  // prefixed ids (buildVmResourceId/buildNodeResourceId) whose first segment
  // is the connection. NEVER inferred from the string shape (spec section 6).
  if (resourceType === "connection" || resourceType === "pbs") return resourceId
  return resourceId.split(":")[0] || null
}

function checkTokenPermission(
  principal: Principal,
  permission: string,
  resourceType?: "connection" | "node" | "vm" | "global" | "pbs",
  resourceId?: string,
): NextResponse | null {
  const deny = () =>
    NextResponse.json({ error: `Permission denied: ${permission}` }, { status: 403 })
  if (!principal.permissions?.has(permission)) {
    return deny()
  }
  // Connection perimeter: only RESOURCE-BEARING checks are constrained.
  // Global and resource-less checks pass — aggregated routes rely on them
  // and filter downstream through the enumeration helpers instead.
  if (principal.connectionIds && resourceType && resourceType !== "global" && resourceId) {
    const connId = resolveTokenConnectionId(resourceType, resourceId)
    // Fail CLOSED: a resource-bearing id whose connection cannot be resolved
    // (e.g. ":node1:qemu:100") is refused, never waved past the perimeter.
    if (!connId || !principal.connectionIds.includes(connId)) {
      return deny()
    }
  }
  return null
}

/**
 * Check if the current caller has a specific permission
 * Returns a 401/403 NextResponse if denied, or null if allowed
 *
 * The session path uses a two-pass approach:
 *   Pass 1: standard scopes (global, connection, node, vm)
 *   Pass 2: if VM resource + user has tag/pool scopes → resolve meta and retry
 */
export async function checkPermission(
  permission: string,
  resourceType?: "connection" | "node" | "vm" | "global" | "pbs",
  resourceId?: string
): Promise<NextResponse | null> {
  const result = await getPrincipal()
  if (!result.ok) {
    return rejectionToResponse(result.rejection)
  }
  const principal = result.principal
  if (principal && principal.kind === "token") {
    // Layer 2 (defense in depth): flat scope permissions + connection
    // perimeter, no DB grants loaded for tokens.
    return checkTokenPermission(principal, permission, resourceType, resourceId)
  }

  if (!principal?.userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const userId = principal.userId
  const tenantId = principal.tenantId

  // Pass 1: standard scopes (global, connection, node, vm)
  if (await hasPermission({ userId, permission, resourceType, resourceId, tenantId })) {
    return null
  }

  // Pass 2: if VM resource + user has tag/pool scopes → resolve meta and retry
  if (resourceType === "vm" && resourceId && (await hasTagOrPoolScopes(userId, tenantId))) {
    const meta = resolveVmMeta(resourceId, tenantId)
    if (
      meta &&
      (await hasPermission({ userId, permission, resourceType, resourceId, resourceMeta: meta, tenantId }))
    ) {
      return null
    }
  }

  return NextResponse.json(
    { error: `Permission denied: ${permission}` },
    { status: 403 }
  )
}

/**
 * Check admin-only permission (for admin routes)
 * Returns a 401/403 NextResponse if denied, or null if allowed
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  return checkPermission(PERMISSIONS.ADMIN_SETTINGS)
}

/**
 * Tags as they arrive from PVE: a `;` or `,` separated string, or already an
 * array. Shared by filterVmsByPermission and loadGuestVisibilityCheck so both
 * match tag grants identically.
 */
function normalizeGuestTags(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[]
  if (typeof value === "string") {
    return value
      .split(/[;,]/)
      .map(t => t.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * Filter a list of VMs based on user permissions
 * Each VM should have: connId, node, type, vmid (or id in format "connId:type:node:vmid")
 */
export async function filterVmsByPermission<T extends { id?: string; connId?: string; node?: string; type?: string; vmid?: string }>(
  principalOrUserId: string | Principal,
  vms: T[],
  permission: string = PERMISSIONS.VM_VIEW,
  tenantId?: string,
): Promise<T[]> {
  const token = asTokenPrincipal(principalOrUserId)
  if (token) {
    if (!token.permissions?.has(permission)) return []
    if (!token.connectionIds) return vms
    const allowed = new Set(token.connectionIds)
    return vms.filter(vm => {
      const connId = vm.connId ?? (vm.id ? vm.id.split(":")[0] : undefined)
      return connId !== undefined && allowed.has(connId)
    })
  }
  const userId = toUserId(principalOrUserId)
  // Load every grant for this user/tenant in one shot, then filter the list
  // with a sync predicate. Was O(N) Prisma calls per filter; now O(1).
  const tid = resolveGrantTenantId(principalOrUserId, tenantId)
  const grants = await loadUserGrants(userId, tid)

  // Super admin or any global-scope grant for this permission → return as-is.
  if (grants.superAdmin) return vms
  if (grants.byScope.some(g => g.scopeType === "global" && g.permissions.has(permission))) {
    return vms
  }

  const result: T[] = []
  for (const vm of vms) {
    let resourceId: string
    if (vm.id && vm.id.includes(":")) {
      // Wire format coming from the inventory route is "connId:type:node:vmid"
      // (type and node swapped vs the canonical RBAC form). Reorder before
      // matching so node-scoped grants line up.
      const parts = vm.id.split(":")
      resourceId = `${parts[0]}:${parts[2]}:${parts[1]}:${parts[3]}`
    } else if (vm.connId && vm.node && vm.type && vm.vmid) {
      resourceId = buildVmResourceId(vm.connId, vm.node, vm.type, vm.vmid)
    } else {
      continue
    }

    // Tags/pool come from the VM payload itself — needed so tag/pool scopes
    // can match on the second pass inside scopeMatches.
    const vmAny = vm as any
    const tags = normalizeGuestTags(vmAny.tags)

    if (checkGrants(grants, permission, "vm", resourceId, { tags, pool: vmAny.pool || undefined })) {
      result.push(vm)
    }
  }
  return result
}

/**
 * Filter a list of nodes based on user permissions
 */
export async function filterNodesByPermission<T extends { connId: string; node: string }>(
  principalOrUserId: string | Principal,
  nodes: T[],
  permission: string = PERMISSIONS.NODE_VIEW,
  tenantId?: string,
): Promise<T[]> {
  const token = asTokenPrincipal(principalOrUserId)
  if (token) {
    if (!token.permissions?.has(permission)) return []
    if (!token.connectionIds) return nodes
    const allowed = new Set(token.connectionIds)
    return nodes.filter(node => allowed.has(node.connId))
  }
  const userId = toUserId(principalOrUserId)
  const tid = resolveGrantTenantId(principalOrUserId, tenantId)
  const grants = await loadUserGrants(userId, tid)

  if (grants.superAdmin) return nodes
  if (grants.byScope.some(g => g.scopeType === "global" && g.permissions.has(permission))) {
    return nodes
  }

  const result: T[] = []
  for (const node of nodes) {
    const resourceId = buildNodeResourceId(node.connId, node.node)
    if (checkGrants(grants, permission, "node", resourceId)) {
      result.push(node)
    }
  }
  return result
}

/**
 * Resolve the RBAC infrastructure-scope tree mask for a user. Mirrors
 * filterVmsByPermission's grant-loading. Returns null when unrestricted
 * (super admin / global scope) -- callers skip tree pruning then.
 */
export async function getRbacInfraScope(
  principalOrUserId: string | Principal,
  tenantId?: string,
): Promise<RbacInfraScope | null> {
  const token = asTokenPrincipal(principalOrUserId)
  if (token) {
    return tokenInfraScope(token.connectionIds ?? null)
  }
  const userId = toUserId(principalOrUserId)
  const tid = resolveGrantTenantId(principalOrUserId, tenantId)
  const grants = await loadUserGrants(userId, tid)
  return deriveRbacInfraScope(grants)
}

export type GuestVisibilityCheck = (guest: {
  connId?: string
  node?: string
  type?: string
  vmid?: string | number
  tags?: string[] | string
  pool?: string
}) => boolean

/**
 * Load a user's grants ONCE and return a synchronous predicate telling whether
 * a single guest is visible. Same matching rules as filterVmsByPermission,
 * including tag/pool metadata, but usable from a hot path such as the SSE
 * delta gate where one DB round-trip per event is not acceptable.
 *
 * The grants are a snapshot: a long-lived subscriber keeps the perimeter it was
 * created with until it reconnects, exactly like getRbacInfraScope above.
 */
export async function loadGuestVisibilityCheck(
  principalOrUserId: string | Principal,
  permission: string = PERMISSIONS.VM_VIEW,
  tenantId?: string,
): Promise<GuestVisibilityCheck> {
  const token = asTokenPrincipal(principalOrUserId)
  if (token) {
    if (!token.permissions?.has(permission)) return () => false
    const allowed = token.connectionIds ? new Set(token.connectionIds) : null
    if (!allowed) return () => true
    return guest => guest.connId !== undefined && allowed.has(guest.connId)
  }

  const userId = toUserId(principalOrUserId)
  const tid = resolveGrantTenantId(principalOrUserId, tenantId)
  const grants = await loadUserGrants(userId, tid)

  return guest => {
    if (!guest.connId || !guest.node || !guest.type || guest.vmid === undefined) return false
    const resourceId = buildVmResourceId(guest.connId, guest.node, guest.type, String(guest.vmid))
    return checkGrants(grants, permission, "vm", resourceId, {
      tags: normalizeGuestTags(guest.tags),
      pool: guest.pool || undefined,
    })
  }
}

/**
 * Scope kinds that carry an infrastructure perimeter. Holding one of them
 * outranks any flat (vm/tag/pool) narrowing: an operator scoped to a whole
 * cluster keeps seeing every pool of that cluster, even when they also hold a
 * pool grant elsewhere (issue #262 acceptance criteria: no regression for
 * Global and Cluster/Connection scopes).
 */
const INFRA_GRANT_SCOPES = new Set(["global", "connection", "node"])

export type GuestScopePerimeter = {
  /**
   * True when the caller only holds flat scopes (vm/tag/pool), so everything a
   * connection-level route returns must be narrowed to what their guests
   * justify. False for admins, tokens and any infra-level grant: no narrowing.
   */
  restricted: boolean
  /** The caller holds `permission` on at least one grant, whatever its scope. */
  holdsPermission: boolean
  /** At least one guest currently hosted on this connection is visible. */
  hasVisibleGuests: boolean
  /** Pools the caller may see on this connection. Only set when `restricted`. */
  pools: Set<string>
  /** Nodes hosting at least one visible guest. Only set when `restricted`. */
  nodes: Set<string>
}

/**
 * Resolve what a flat-scoped caller (vm/tag/pool) may legitimately see on ONE
 * connection, derived from the guests they can already see there.
 *
 * `scopeMatches` can never satisfy a `"connection"` resource check for such a
 * caller (a connection carries no tag and no pool), so every connection-scoped
 * read route 403s on them, including the two the Create VM wizard needs
 * (issue #262). The perimeter below is what those routes use instead: let the
 * caller through when they hold the permission AND own a guest on the cluster,
 * then narrow the payload to `pools` / `nodes`.
 *
 * Nothing here widens what the user already knows: the inventory stream
 * already sends them their guests along with the cluster and node hosting them
 * (issue #633, guest-derived perimeter). It only stops the same routes from
 * answering with the whole cluster.
 *
 * Fails closed: an inventory cache miss yields `hasVisibleGuests: false`, so
 * the caller keeps the 403 rather than receiving an unnarrowed payload.
 */
export async function getGuestScopePerimeter(
  principalOrUserId: string | Principal,
  connId: string,
  permission: string = PERMISSIONS.CONNECTION_VIEW,
  tenantId?: string,
): Promise<GuestScopePerimeter> {
  const unrestricted: GuestScopePerimeter = {
    restricted: false,
    holdsPermission: true,
    hasVisibleGuests: false,
    pools: new Set<string>(),
    nodes: new Set<string>(),
  }

  // A token carries flat scope permissions plus a connection perimeter, never
  // a pool grant. checkTokenPermission already decided; nothing to widen.
  if (asTokenPrincipal(principalOrUserId)) return unrestricted

  const userId = toUserId(principalOrUserId)
  const tid = resolveGrantTenantId(principalOrUserId, tenantId)
  const grants = await loadUserGrants(userId, tid)
  if (grants.superAdmin) return unrestricted

  let holdsPermission = false
  const grantedPools = new Set<string>()
  for (const g of grants.byScope) {
    const carries = g.permissions.has(permission)
    if (carries) holdsPermission = true
    if (carries && INFRA_GRANT_SCOPES.has(g.scopeType)) {
      return { ...unrestricted, holdsPermission: true }
    }
    if (g.scopeType === "pool" && g.scopeTarget) grantedPools.add(g.scopeTarget)
  }

  // Guest-derived half: the pools and nodes the caller's own guests sit in.
  // Covers tag scopes too, which have no pool grant to read from.
  const isVisible = await loadGuestVisibilityCheck(principalOrUserId, PERMISSIONS.VM_VIEW, tid)
  const found = scanVisibleGuests(tid, isVisible, connId).get(connId)
  const pools = new Set<string>(grantedPools)

  for (const pool of found?.pools ?? []) pools.add(pool)

  return {
    restricted: true,
    holdsPermission,
    hasVisibleGuests: !!found,
    pools,
    nodes: found?.nodes ?? new Set<string>(),
  }
}

/**
 * Walk the cached inventory and collect, per connection, the nodes and pools
 * holding a guest the caller can see. Connections without a single visible
 * guest are absent from the map, which is what makes it usable as a gate.
 *
 * Reads the cache only: on a miss the caller is treated as seeing nothing,
 * which keeps every consumer fail-closed.
 */
function scanVisibleGuests(
  tenantId: string,
  isVisible: GuestVisibilityCheck,
  onlyConnId?: string,
): Map<string, { nodes: Set<string>; pools: Set<string> }> {
  const byConnection = new Map<string, { nodes: Set<string>; pools: Set<string> }>()

  for (const inventory of getTenantInventoriesFromCache(tenantId)) {
    for (const cluster of (inventory.clusters ?? []) as any[]) {
      const connId = cluster?.id
      if (!connId) continue
      if (onlyConnId !== undefined && connId !== onlyConnId) continue
      for (const node of (cluster.nodes ?? []) as any[]) {
        for (const guest of (node?.guests ?? []) as any[]) {
          if (
            !isVisible({
              connId,
              node: node.node,
              type: guest.type,
              vmid: guest.vmid,
              tags: guest.tags,
              pool: guest.pool,
            })
          ) {
            continue
          }
          let entry = byConnection.get(connId)
          if (!entry) {
            entry = { nodes: new Set<string>(), pools: new Set<string>() }
            byConnection.set(connId, entry)
          }
          if (node.node) entry.nodes.add(node.node)
          if (guest.pool) entry.pools.add(guest.pool)
        }
      }
    }
  }

  return byConnection
}

/**
 * Connections currently hosting at least one guest the caller can see.
 *
 * Companion of `filterVisibleConnections`, which stays strict on purpose: a
 * flat-scoped user has no business enumerating connections in the inventory.
 * Provisioning is the exception, since a VM cannot be created without naming a
 * cluster and a node, hence a separate opt-in helper rather than a relaxation
 * of the default perimeter.
 */
export async function getGuestVisibleConnectionIds(
  principalOrUserId: string | Principal,
  tenantId?: string,
): Promise<Set<string>> {
  if (asTokenPrincipal(principalOrUserId)) return new Set<string>()
  const tid = resolveGrantTenantId(principalOrUserId, tenantId)
  const isVisible = await loadGuestVisibilityCheck(principalOrUserId, PERMISSIONS.VM_VIEW, tid)
  return new Set(scanVisibleGuests(tid, isVisible).keys())
}

/**
 * Pools a caller may see on one connection. `restricted: false` means no
 * narrowing at all (admin, token, or an infra-level grant), so the caller
 * keeps the full list the connection exposes.
 *
 * Thin read of {@link getGuestScopePerimeter}; use that one directly when the
 * node perimeter or the gate decision is needed too.
 */
export async function getAccessiblePools(
  principalOrUserId: string | Principal,
  connId: string,
  tenantId?: string,
): Promise<{ restricted: boolean; pools: Set<string> }> {
  const perimeter = await getGuestScopePerimeter(
    principalOrUserId,
    connId,
    PERMISSIONS.CONNECTION_VIEW,
    tenantId,
  )
  return { restricted: perimeter.restricted, pools: perimeter.pools }
}

/**
 * Request-scoped wrapper over {@link getGuestScopePerimeter}: resolves the
 * caller from the session first. Returns null when there is no session user
 * (unauthenticated, or a token principal, which never holds a pool grant), so
 * a route can simply keep its 403 in that case.
 */
export async function getRequestGuestScopePerimeter(
  connId: string,
  permission: string = PERMISSIONS.CONNECTION_VIEW,
): Promise<GuestScopePerimeter | null> {
  const ctx = await getRBACContext()
  if (!ctx?.userId) return null
  return getGuestScopePerimeter(ctx.userId, connId, permission, ctx.tenantId)
}

/**
 * Boolean form of {@link getRequestGuestScopePerimeter} for the routes that
 * only need the gate, not the perimeter: connection-level facts (bridges, CPU
 * models, storage contents) a flat-scoped caller must be able to read to fill
 * in the creation wizard. Placement is cluster-wide by design, so the node in
 * the URL is not required to already host one of their guests.
 *
 * Use as `if (denied && !(await guestPerimeterAllows(id, PERMISSIONS.X))) return denied`.
 */
export async function guestPerimeterAllows(connId: string, permission: string): Promise<boolean> {
  const perimeter = await getRequestGuestScopePerimeter(connId, permission)
  return !!(perimeter?.holdsPermission && perimeter.hasVisibleGuests)
}
