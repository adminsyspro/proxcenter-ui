// src/lib/audit/index.ts
import { headers } from "next/headers"

import { nanoid } from "nanoid"
import { getServerSession } from "next-auth"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import { authOptions } from "@/lib/auth/config"
import { getCurrentTenantId } from "@/lib/tenant"

export type AuditCategory =
  | "auth"           // Connexion, déconnexion, changement de mot de passe
  | "users"          // Gestion des utilisateurs
  | "connections"    // Gestion des connexions Proxmox
  | "vms"            // Actions sur les VMs
  | "containers"     // Actions sur les containers
  | "nodes"          // Actions sur les nodes
  | "storage"        // Actions sur le stockage
  | "backups"        // Actions sur les backups
  | "settings"       // Modifications de configuration
  | "system"         // Actions système
  | "security"       // Actions de sécurité (RBAC, permissions)
  | "templates"      // Actions cloud-init templates / blueprints
  | "migration"      // Migration ESXi → Proxmox
  | "admin"          // Admin actions (tenants, etc.)
  | "sdn"            // SDN (zones, vnets, apply)

export type AuditAction =

  // Auth
  | "login"
  | "logout"
  | "login_failed"
  | "password_changed"

  // CRUD
  | "create"
  | "read"
  | "update"
  | "delete"

  // VM/Container actions
  | "start"
  | "stop"
  | "restart"
  | "suspend"
  | "resume"
  | "migrate"
  | "clone"
  | "snapshot"
  | "backup"
  | "restore"

  // Other
  | "export"
  | "import"
  | "test"
  | "enable"
  | "disable"

  // RBAC
  | "rbac_role_created"
  | "rbac_role_updated"
  | "rbac_role_deleted"
  | "rbac_role_assigned"
  | "rbac_role_revoked"
  | "rbac_assignment_updated"

  // Tenants
  | "tenant.create"
  | "tenant.update"
  | "tenant.delete"
  | "tenant.switch"
  | "tenant.add_user"
  | "tenant.remove_user"

  // SDN
  | "sdn.apply"

  // 2FA
  | "2fa_enrolled"
  | "2fa_disabled"
  | "2fa_login_failed"
  | "2fa_recovery_used"
  | "2fa_recovery_low"
  | "2fa_recovery_regenerated"
  | "2fa_required_for_user"
  | "2fa_requirement_cleared"

export type AuditStatus = "success" | "failure" | "warning"

export interface AuditLogEntry {
  action: AuditAction
  category: AuditCategory
  resourceType?: string
  resourceId?: string
  resourceName?: string
  details?: Record<string, any>
  status?: AuditStatus
  errorMessage?: string

  // Ces champs sont auto-remplis si non fournis
  userId?: string
  userEmail?: string
  ipAddress?: string
  userAgent?: string
}

/**
 * Enregistre une entrée dans les logs d'audit. La table `audit_logs.details`
 * est désormais JSONB (Postgres), donc on stocke l'objet JS tel quel — plus
 * besoin de JSON.stringify côté caller. Si les infos de session / headers ne
 * sont pas fournies par l'appelant, on tente de les récupérer depuis la
 * requête en cours (best-effort, l'absence n'est jamais bloquante).
 */
export async function audit(entry: AuditLogEntry): Promise<string> {
  const id = nanoid()
  const timestamp = new Date()

  // Récupérer les infos de session si non fournies
  let userId = entry.userId
  let userEmail = entry.userEmail
  let ipAddress = entry.ipAddress
  let userAgent = entry.userAgent

  if (!userId || !userEmail) {
    try {
      const session = await getServerSession(authOptions)

      if (session?.user) {
        userId = userId || session.user.id
        userEmail = userEmail || session.user.email
      }
    } catch {
      // Pas de session (ex: login)
    }
  }

  if (!ipAddress || !userAgent) {
    try {
      const headersList = await headers()

      ipAddress = ipAddress || headersList.get("x-forwarded-for") || headersList.get("x-real-ip") || "unknown"
      userAgent = userAgent || headersList.get("user-agent") || "unknown"
    } catch {
      // Headers non disponibles
    }
  }

  // Get tenant ID for scoping
  let tenantId = "default"
  try {
    tenantId = await getCurrentTenantId()
  } catch {
    // Fallback to default (e.g. during login before session exists)
  }

  await prisma.auditLog.create({
    data: {
      id,
      tenantId,
      timestamp,
      userId: userId || null,
      userEmail: userEmail || null,
      action: entry.action,
      category: entry.category,
      resourceType: entry.resourceType || null,
      resourceId: entry.resourceId || null,
      resourceName: entry.resourceName || null,
      details: (entry.details ?? null) as Prisma.InputJsonValue,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      status: entry.status || "success",
      errorMessage: entry.errorMessage || null,
    },
  })

  return id
}

/**
 * Raccourci pour les audits d'authentification
 */
export async function auditAuth(
  action: "login" | "logout" | "login_failed" | "password_changed",
  userEmail: string,
  details?: Record<string, any>,
  status: AuditStatus = "success",
  errorMessage?: string
) {
  return audit({
    action,
    category: "auth",
    userEmail,
    details,
    status,
    errorMessage,
  })
}

/**
 * Raccourci pour les audits de ressources (CRUD)
 */
export async function auditResource(
  action: AuditAction,
  category: AuditCategory,
  resourceType: string,
  resourceId: string,
  resourceName?: string,
  details?: Record<string, any>,
  status: AuditStatus = "success",
  errorMessage?: string
) {
  return audit({
    action,
    category,
    resourceType,
    resourceId,
    resourceName,
    details,
    status,
    errorMessage,
  })
}

/**
 * Récupère les logs d'audit avec filtres et pagination.
 *
 * The legacy raw-SQL version surfaced rows in the SQLite shape (snake_case
 * columns, ISO-string timestamps, JSON-string details). We translate the
 * Prisma rows back into that wire shape so the API consumer (which the
 * `/api/v1/audit` route forwards verbatim to the frontend) keeps the same
 * field names and value types after the cutover.
 */
export async function getAuditLogs(options: {
  tenantId: string
  limit?: number
  offset?: number
  category?: AuditCategory
  action?: AuditAction
  userId?: string
  resourceType?: string
  resourceId?: string
  status?: AuditStatus
  startDate?: string
  endDate?: string
  search?: string
}): Promise<{
  data: Array<Record<string, unknown>>
  meta: { total: number; limit: number; offset: number }
}> {
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0

  const where: Prisma.AuditLogWhereInput = { tenantId: options.tenantId }
  if (options.category) where.category = options.category
  if (options.action) where.action = options.action
  if (options.userId) where.userId = options.userId
  if (options.resourceType) where.resourceType = options.resourceType
  if (options.resourceId) where.resourceId = options.resourceId
  if (options.status) where.status = options.status

  if (options.startDate || options.endDate) {
    const ts: Prisma.DateTimeFilter = {}
    if (options.startDate) ts.gte = new Date(options.startDate)
    if (options.endDate) ts.lte = new Date(options.endDate)
    where.timestamp = ts
  }

  if (options.search) {
    // Mirror the legacy LIKE %term% across user_email / resource_name / action.
    // Postgres supports `mode: 'insensitive'`; we keep it case-sensitive here
    // to stay byte-for-byte compatible with the SQLite behaviour. Flip the
    // mode flag once the consumer is confirmed insensitive-friendly.
    const term = options.search
    where.OR = [
      { userEmail: { contains: term } },
      { resourceName: { contains: term } },
      { action: { contains: term } },
    ]
  }

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit,
      skip: offset,
    }),
  ])

  // Re-map Prisma camelCase + JSONB → legacy SQLite snake_case + JSON-string
  // shape so the public response wire contract is unchanged.
  const data = rows.map(row => ({
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    user_id: row.userId,
    user_email: row.userEmail,
    action: row.action,
    category: row.category,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    resource_name: row.resourceName,
    details: row.details === null || row.details === undefined ? null : JSON.stringify(row.details),
    ip_address: row.ipAddress,
    user_agent: row.userAgent,
    status: row.status,
    error_message: row.errorMessage,
    tenant_id: row.tenantId,
  }))

  return { data, meta: { total, limit, offset } }
}
