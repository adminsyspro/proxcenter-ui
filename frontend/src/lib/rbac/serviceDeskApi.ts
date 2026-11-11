// src/lib/rbac/serviceDeskApi.ts
//
// Wire shape and request helpers of the service-desk assignment routes (ui#1336).

import { prisma } from "@/lib/db/prisma"

import { SERVICE_DESK_ROW_PREFIX } from "./serviceDesk"

export const assignmentSelect = {
  id: true,
  allTenants: true,
  tenantIds: true,
  grantedAt: true,
  expiresAt: true,
  user: { select: { id: true, email: true, name: true } },
  role: { select: { id: true, name: true, color: true } },
  grantedBy: { select: { email: true } },
} as const

export type AssignmentRow = {
  id: string
  allTenants: boolean
  tenantIds: string[]
  grantedAt: Date
  expiresAt: Date | null
  user: { id: string; email: string; name: string | null }
  role: { id: string; name: string; color: string | null }
  grantedBy: { email: string } | null
}

/** Wire shape, with the tenants the assignment reaches right now. */
export function toWire(a: AssignmentRow, reached: { id: string; name: string }[]) {
  return {
    id: a.id,
    user: a.user,
    role: a.role,
    all_tenants: a.allTenants,
    tenant_ids: a.tenantIds ?? [],
    tenants: reached,
    granted_at: a.grantedAt.toISOString(),
    granted_by_email: a.grantedBy?.email ?? null,
    expires_at: a.expiresAt?.toISOString() ?? null,
  }
}

/** assignment id -> tenants its materialised rows sit in. */
export async function reachedTenants(assignmentIds: string[]): Promise<Map<string, { id: string; name: string }[]>> {
  const out = new Map<string, { id: string; name: string }[]>()
  if (assignmentIds.length === 0) return out
  const rows = await prisma.rbacUserRole.findMany({
    where: { OR: assignmentIds.map(id => ({ id: { startsWith: `${SERVICE_DESK_ROW_PREFIX}${id}_` } })) },
    select: { id: true, tenantId: true },
  })
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: Array.from(new Set(rows.map(r => r.tenantId))) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(tenants.map(t => [t.id, t.name]))
  for (const assignmentId of assignmentIds) {
    const prefix = `${SERVICE_DESK_ROW_PREFIX}${assignmentId}_`
    out.set(
      assignmentId,
      rows
        .filter(r => r.id.startsWith(prefix))
        .map(r => ({ id: r.tenantId, name: nameById.get(r.tenantId) ?? r.tenantId }))
        .sort((x, y) => x.name.localeCompare(y.name)),
    )
  }
  return out
}

export function parseExpiry(raw: unknown): { ok: boolean; value?: Date | null } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null }
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d }
}

