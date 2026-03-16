// src/lib/tenant/index.ts
// Multi-tenancy helpers

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { getDb } from "@/lib/db/sqlite"
import { prisma } from "@/lib/db/prisma"

export const DEFAULT_TENANT_ID = "default"

export interface Tenant {
  id: string
  slug: string
  name: string
  description: string | null
  enabled: boolean
  settings: Record<string, any> | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Get current tenant ID from the session JWT.
 * Falls back to 'default' if not set (backwards-compatible).
 */
export async function getCurrentTenantId(): Promise<string> {
  const session = await getServerSession(authOptions)
  const tenantId = (session as any)?.user?.tenantId || DEFAULT_TENANT_ID

  // Verify tenant exists and is enabled
  const db = getDb()
  const tenant = db.prepare(
    "SELECT id, enabled FROM tenants WHERE id = ?"
  ).get(tenantId) as any

  if (!tenant) return DEFAULT_TENANT_ID
  if (!tenant.enabled) return DEFAULT_TENANT_ID

  // Verify the user actually belongs to this tenant (guards against stale JWTs)
  const userId = (session as any)?.user?.id
  if (userId && tenantId !== DEFAULT_TENANT_ID && !userHasAccessToTenant(userId, tenantId)) {
    return DEFAULT_TENANT_ID
  }

  return tenantId
}

/**
 * Get tenants accessible by a user.
 */
export function getUserTenants(userId: string): Tenant[] {
  const db = getDb()
  return db.prepare(`
    SELECT t.id, t.slug, t.name, t.description, t.enabled, t.settings,
           t.created_by as createdBy, t.created_at as createdAt, t.updated_at as updatedAt
    FROM tenants t
    JOIN user_tenants ut ON ut.tenant_id = t.id
    WHERE ut.user_id = ? AND t.enabled = 1
    ORDER BY ut.is_default DESC, t.name ASC
  `).all(userId) as Tenant[]
}

/**
 * Get user's default tenant ID.
 */
export function getUserDefaultTenantId(userId: string): string {
  const db = getDb()
  const row = db.prepare(`
    SELECT tenant_id FROM user_tenants
    WHERE user_id = ? AND is_default = 1
    LIMIT 1
  `).get(userId) as any

  return row?.tenant_id || DEFAULT_TENANT_ID
}

/**
 * Check if a user has access to a specific tenant.
 */
export function userHasAccessToTenant(userId: string, tenantId: string): boolean {
  const db = getDb()
  const row = db.prepare(
    "SELECT 1 FROM user_tenants WHERE user_id = ? AND tenant_id = ?"
  ).get(userId, tenantId)
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
 * Get the set of connection IDs belonging to the current tenant.
 * Used to filter orchestrator data that is not tenant-aware.
 */
export async function getTenantConnectionIds(): Promise<Set<string>> {
  const tenantPrisma = await getSessionPrisma()
  const connections = await tenantPrisma.connection.findMany({ select: { id: true } })
  return new Set(connections.map((c: any) => c.id))
}

/**
 * Verify a connection ID belongs to the current tenant.
 * Returns a 404 NextResponse if not, or null if OK.
 */
export async function verifyConnectionOwnership(connectionId: string): Promise<Response | null> {
  const tenantConnectionIds = await getTenantConnectionIds()
  if (!tenantConnectionIds.has(connectionId)) {
    const { NextResponse } = await import('next/server')
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }
  return null
}

/**
 * List all tenants (admin only).
 */
export function listTenants(): Tenant[] {
  const db = getDb()
  return db.prepare(
    "SELECT id, slug, name, description, enabled, settings, created_by as createdBy, created_at as createdAt, updated_at as updatedAt FROM tenants ORDER BY name"
  ).all() as Tenant[]
}

/**
 * Create a new tenant.
 */
export function createTenant(data: { slug: string; name: string; description?: string; createdBy?: string }): Tenant {
  const db = getDb()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  db.prepare(
    "INSERT INTO tenants (id, slug, name, description, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
  ).run(id, data.slug, data.name, data.description || null, data.createdBy || null, now, now)

  return db.prepare("SELECT id, slug, name, description, enabled, settings, created_by as createdBy, created_at as createdAt, updated_at as updatedAt FROM tenants WHERE id = ?").get(id) as Tenant
}

/**
 * Update a tenant.
 */
export function updateTenant(id: string, data: { name?: string; slug?: string; description?: string; enabled?: boolean }): Tenant | null {
  const db = getDb()
  const now = new Date().toISOString()
  const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(id) as any
  if (!tenant) return null

  db.prepare(
    "UPDATE tenants SET name = ?, slug = ?, description = ?, enabled = ?, updated_at = ? WHERE id = ?"
  ).run(
    data.name ?? tenant.name,
    data.slug ?? tenant.slug,
    data.description ?? tenant.description,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : tenant.enabled,
    now,
    id
  )

  return db.prepare("SELECT id, slug, name, description, enabled, settings, created_by as createdBy, created_at as createdAt, updated_at as updatedAt FROM tenants WHERE id = ?").get(id) as Tenant
}

/**
 * Delete a tenant (cannot delete 'default').
 */
export function deleteTenant(id: string): boolean {
  if (id === DEFAULT_TENANT_ID) return false
  const db = getDb()
  const result = db.prepare("DELETE FROM tenants WHERE id = ? AND id != 'default'").run(id)
  return result.changes > 0
}

/**
 * Add a user to a tenant.
 */
export function addUserToTenant(userId: string, tenantId: string, isDefault = false): void {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(
    "INSERT OR IGNORE INTO user_tenants (user_id, tenant_id, is_default, joined_at) VALUES (?, ?, ?, ?)"
  ).run(userId, tenantId, isDefault ? 1 : 0, now)
}

/**
 * Remove a user from a tenant.
 */
export function removeUserFromTenant(userId: string, tenantId: string): void {
  if (tenantId === DEFAULT_TENANT_ID) return
  const db = getDb()
  db.prepare("DELETE FROM user_tenants WHERE user_id = ? AND tenant_id = ?").run(userId, tenantId)
}

/**
 * Get users in a tenant.
 */
export function getTenantUsers(tenantId: string): any[] {
  const db = getDb()
  return db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.enabled, ut.is_default, ut.joined_at
    FROM users u
    JOIN user_tenants ut ON ut.user_id = u.id
    WHERE ut.tenant_id = ?
    ORDER BY u.name
  `).all(tenantId)
}
