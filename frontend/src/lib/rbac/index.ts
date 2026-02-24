// src/lib/rbac/index.ts
// RBAC helper functions for permission checking

import { NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { getDb } from "@/lib/db/sqlite"
import { authOptions } from "@/lib/auth/config"
import { resolveVmMeta } from "@/lib/cache/vmMetaCache"


export interface PermissionCheck {
  userId: string
  permission: string
  resourceType?: "connection" | "node" | "vm" | "global" | "pbs"
  resourceId?: string
  resourceMeta?: { tags?: string[]; pool?: string }
}

/**
 * Check if a user has a specific permission
 * @param check - The permission check parameters
 * @returns true if the user has the permission, false otherwise
 */
export function hasPermission(check: PermissionCheck): boolean {
  const { userId, permission, resourceType, resourceId, resourceMeta } = check
  const db = getDb()

  // Check via RBAC roles
  // Get all user's active roles
  const userRoles = db.prepare(`
    SELECT ur.role_id, ur.scope_type, ur.scope_target
    FROM rbac_user_roles ur
    WHERE ur.user_id = ?
      AND (ur.expires_at IS NULL OR ur.expires_at > datetime('now'))
  `).all(userId) as any[]

  // Check if any role grants this permission with matching scope
  for (const role of userRoles) {
    // Check if role has the permission
    const hasPerm = db.prepare(`
      SELECT 1 FROM rbac_role_permissions rp
      JOIN rbac_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND p.name = ?
    `).get(role.role_id, permission)

    if (hasPerm) {
      // Check scope
      if (scopeMatches(role.scope_type, role.scope_target, resourceType, resourceId, resourceMeta)) {
        return true
      }
    }
  }

  // Check direct permissions
  const directPerm = db.prepare(`
    SELECT up.scope_type, up.scope_target
    FROM rbac_user_permissions up
    JOIN rbac_permissions p ON p.id = up.permission_id
    WHERE up.user_id = ? AND p.name = ?
      AND (up.expires_at IS NULL OR up.expires_at > datetime('now'))
  `).all(userId, permission) as any[]

  for (const perm of directPerm) {
    if (scopeMatches(perm.scope_type, perm.scope_target, resourceType, resourceId, resourceMeta)) {
      return true
    }
  }

  return false
}

/**
 * Get all effective permissions for a user
 */
export function getEffectivePermissions(userId: string, resourceType?: string, resourceId?: string): string[] {
  const db = getDb()
  const permissions = new Set<string>()

  // Get permissions from roles
  const rolePerms = db.prepare(`
    SELECT DISTINCT p.name, ur.scope_type, ur.scope_target
    FROM rbac_user_roles ur
    JOIN rbac_role_permissions rp ON rp.role_id = ur.role_id
    JOIN rbac_permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ?
      AND (ur.expires_at IS NULL OR ur.expires_at > datetime('now'))
  `).all(userId) as any[]

  for (const perm of rolePerms) {
    if (scopeMatches(perm.scope_type, perm.scope_target, resourceType, resourceId)) {
      permissions.add(perm.name)
    }
  }

  // Get direct permissions
  const directPerms = db.prepare(`
    SELECT p.name, up.scope_type, up.scope_target
    FROM rbac_user_permissions up
    JOIN rbac_permissions p ON p.id = up.permission_id
    WHERE up.user_id = ?
      AND (up.expires_at IS NULL OR up.expires_at > datetime('now'))
  `).all(userId) as any[]

  for (const perm of directPerms) {
    if (scopeMatches(perm.scope_type, perm.scope_target, resourceType, resourceId)) {
      permissions.add(perm.name)
    }
  }

  return Array.from(permissions)
}

/**
 * Check if multiple permissions are granted
 */
export function hasAllPermissions(userId: string, permissions: string[], resourceType?: string, resourceId?: string): boolean {
  return permissions.every(perm => hasPermission({ userId, permission: perm, resourceType: resourceType as any, resourceId }))
}

/**
 * Check if at least one permission is granted
 */
export function hasAnyPermission(userId: string, permissions: string[], resourceType?: string, resourceId?: string): boolean {
  return permissions.some(perm => hasPermission({ userId, permission: perm, resourceType: resourceType as any, resourceId }))
}

/**
 * Get all resources a user can access with a specific permission
 */
export function getAccessibleResources(userId: string, permission: string): { scope_type: string; scope_target: string | null }[] {
  const db = getDb()
  const resources: { scope_type: string; scope_target: string | null }[] = []

  // Get from roles
  const fromRoles = db.prepare(`
    SELECT DISTINCT ur.scope_type, ur.scope_target
    FROM rbac_user_roles ur
    JOIN rbac_role_permissions rp ON rp.role_id = ur.role_id
    JOIN rbac_permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ? AND p.name = ?
      AND (ur.expires_at IS NULL OR ur.expires_at > datetime('now'))
  `).all(userId, permission) as any[]

  resources.push(...fromRoles)

  // Get direct permissions
  const direct = db.prepare(`
    SELECT up.scope_type, up.scope_target
    FROM rbac_user_permissions up
    JOIN rbac_permissions p ON p.id = up.permission_id
    WHERE up.user_id = ? AND p.name = ?
      AND (up.expires_at IS NULL OR up.expires_at > datetime('now'))
  `).all(userId, permission) as any[]

  resources.push(...direct)

  return resources
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
 * Get the current user's RBAC context from the session
 * Returns null if not authenticated
 */
export async function getRBACContext(): Promise<{ userId: string; isAdmin: boolean } | null> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return null
  }

  const db = getDb()
  const superAdmin = db.prepare(`
    SELECT 1 FROM rbac_user_roles
    WHERE user_id = ? AND role_id = 'role_super_admin' AND scope_type = 'global'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).get(session.user.id)

  return {
    userId: session.user.id,
    isAdmin: !!superAdmin
  }
}

/**
 * Check if a user has any tag or pool scoped assignments (roles or direct permissions).
 * Used to decide whether to attempt the second pass in checkPermission().
 */
export function hasTagOrPoolScopes(userId: string): boolean {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT 1 FROM rbac_user_roles
       WHERE user_id = ? AND scope_type IN ('tag', 'pool')
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       LIMIT 1`
    )
    .get(userId)
  if (row) return true

  const row2 = db
    .prepare(
      `SELECT 1 FROM rbac_user_permissions
       WHERE user_id = ? AND scope_type IN ('tag', 'pool')
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       LIMIT 1`
    )
    .get(userId)
  return !!row2
}

/**
 * Check if the current user has a specific permission
 * Returns a 401/403 NextResponse if denied, or null if allowed
 *
 * Uses a two-pass approach:
 *   Pass 1: standard scopes (global, connection, node, vm)
 *   Pass 2: if VM resource + user has tag/pool scopes → resolve meta and retry
 */
export async function checkPermission(
  permission: string,
  resourceType?: "connection" | "node" | "vm" | "global" | "pbs",
  resourceId?: string
): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const userId = session.user.id

  // Pass 1: standard scopes (global, connection, node, vm)
  if (hasPermission({ userId, permission, resourceType, resourceId })) {
    return null
  }

  // Pass 2: if VM resource + user has tag/pool scopes → resolve meta and retry
  if (resourceType === "vm" && resourceId && hasTagOrPoolScopes(userId)) {
    const meta = resolveVmMeta(resourceId)
    if (
      meta &&
      hasPermission({ userId, permission, resourceType, resourceId, resourceMeta: meta })
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
 * Filter a list of VMs based on user permissions
 * Each VM should have: connId, node, type, vmid (or id in format "connId:type:node:vmid")
 */
export function filterVmsByPermission<T extends { id?: string; connId?: string; node?: string; type?: string; vmid?: string }>(
  userId: string,
  vms: T[],
  permission: string = PERMISSIONS.VM_VIEW
): T[] {
  // Get accessible resources for this permission
  const resources = getAccessibleResources(userId, permission)

  // Check for global access
  if (resources.some(r => r.scope_type === "global")) {
    return vms
  }

  return vms.filter(vm => {
    // Build resource ID from VM
    let resourceId: string

    if (vm.id && vm.id.includes(":")) {
      // Format: "connId:type:node:vmid"
      const parts = vm.id.split(":")

      resourceId = `${parts[0]}:${parts[2]}:${parts[1]}:${parts[3]}`
    } else if (vm.connId && vm.node && vm.type && vm.vmid) {
      resourceId = buildVmResourceId(vm.connId, vm.node, vm.type, vm.vmid)
    } else {
      return false
    }

    // Extract tags/pool from VM object for tag/pool scope matching
    const vmAny = vm as any
    const tags = Array.isArray(vmAny.tags)
      ? vmAny.tags
      : typeof vmAny.tags === "string"
        ? vmAny.tags
            .split(/[;,]/)
            .map((t: string) => t.trim())
            .filter(Boolean)
        : []

    return hasPermission({
      userId,
      permission,
      resourceType: "vm",
      resourceId,
      resourceMeta: { tags, pool: vmAny.pool || undefined }
    })
  })
}

/**
 * Filter a list of nodes based on user permissions
 */
export function filterNodesByPermission<T extends { connId: string; node: string }>(
  userId: string,
  nodes: T[],
  permission: string = PERMISSIONS.NODE_VIEW
): T[] {
  // Get accessible resources
  const resources = getAccessibleResources(userId, permission)

  if (resources.some(r => r.scope_type === "global")) {
    return nodes
  }

  return nodes.filter(node => {
    const resourceId = buildNodeResourceId(node.connId, node.node)

    
return hasPermission({
      userId,
      permission,
      resourceType: "node",
      resourceId
    })
  })
}
