// src/lib/audit/index.ts
import { headers } from "next/headers"

import { nanoid } from "nanoid"
import { getServerSession } from "next-auth"

import { getDb } from "@/lib/db/sqlite"
import { authOptions } from "@/lib/auth/config"

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
 * Enregistre une entrée dans les logs d'audit
 */
export async function audit(entry: AuditLogEntry): Promise<string> {
  const db = getDb()
  const id = nanoid()
  const timestamp = new Date().toISOString()

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

  const details = entry.details ? JSON.stringify(entry.details) : null

  db.prepare(
    `INSERT INTO audit_logs (
      id, timestamp, user_id, user_email, action, category, 
      resource_type, resource_id, resource_name, details,
      ip_address, user_agent, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    timestamp,
    userId || null,
    userEmail || null,
    entry.action,
    entry.category,
    entry.resourceType || null,
    entry.resourceId || null,
    entry.resourceName || null,
    details,
    ipAddress || null,
    userAgent || null,
    entry.status || "success",
    entry.errorMessage || null
  )

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
 * Récupère les logs d'audit avec filtres et pagination
 */
export function getAuditLogs(options: {
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
}) {
  const db = getDb()
  const conditions: string[] = []
  const params: any[] = []

  if (options.category) {
    conditions.push("category = ?")
    params.push(options.category)
  }

  if (options.action) {
    conditions.push("action = ?")
    params.push(options.action)
  }

  if (options.userId) {
    conditions.push("user_id = ?")
    params.push(options.userId)
  }

  if (options.resourceType) {
    conditions.push("resource_type = ?")
    params.push(options.resourceType)
  }

  if (options.resourceId) {
    conditions.push("resource_id = ?")
    params.push(options.resourceId)
  }

  if (options.status) {
    conditions.push("status = ?")
    params.push(options.status)
  }

  if (options.startDate) {
    conditions.push("timestamp >= ?")
    params.push(options.startDate)
  }

  if (options.endDate) {
    conditions.push("timestamp <= ?")
    params.push(options.endDate)
  }

  if (options.search) {
    conditions.push("(user_email LIKE ? OR resource_name LIKE ? OR action LIKE ?)")
    const searchPattern = `%${options.search}%`

    params.push(searchPattern, searchPattern, searchPattern)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = options.limit || 100
  const offset = options.offset || 0

  // Récupérer le total
  const countResult = db
    .prepare(`SELECT COUNT(*) as count FROM audit_logs ${whereClause}`)
    .get(...params) as { count: number }

  // Récupérer les logs
  const logs = db
    .prepare(
      `SELECT * FROM audit_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)

  return {
    data: logs,
    meta: {
      total: countResult.count,
      limit,
      offset,
    },
  }
}
