// src/lib/rbac/catalogueGuards.ts
//
// Request-side checks shared by the role routes for the provider role
// catalogue (ui#1336).

import { NextResponse } from "next/server"

import { audit } from "@/lib/audit"
import { prisma } from "@/lib/db/prisma"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import { ceilingViolations, PUBLISHED_AUDIENCES } from "./rolePublication"
import { loadTenantCeiling } from "./serviceDesk"

/**
 * The permission ceiling of published roles (ui#1336): a role offered to
 * customer tenants carries nothing a Tenant Admin could not hold. Returns the
 * 400 naming the offending permissions, audited, or null.
 */
export async function refuseOverCeiling(
  audience: string | null,
  permIds: string[],
  user: { id: string; email?: string | null },
  roleName: string,
): Promise<NextResponse | null> {
  if (audience === null || !(PUBLISHED_AUDIENCES as readonly string[]).includes(audience)) return null
  const violations = ceilingViolations(permIds, await loadTenantCeiling())
  if (violations.length === 0) return null
  await audit({
    action: "rbac_role_ceiling_refused",
    category: "security",
    userId: user.id,
    userEmail: user.email ?? undefined,
    resourceType: "rbac_role",
    resourceName: roleName,
    details: { audience, permissions: violations },
    status: "failure",
  })
  return NextResponse.json(
    {
      error: `These permissions cannot be given to a role published to tenants: ${violations.join(", ")}`,
      code: "PERMISSION_CEILING",
      permissions: violations,
    },
    { status: 400 },
  )
}

/** The first id of `tenantIds` that is not an existing customer tenant, or null. */
export async function findUnknownTenant(tenantIds: string[]): Promise<string | null> {
  if (tenantIds.length === 0) return null
  const known = await prisma.tenant.findMany({
    where: { id: { in: tenantIds, not: DEFAULT_TENANT_ID } },
    select: { id: true },
  })
  const knownIds = new Set(known.map(t => t.id))
  return tenantIds.find(id => !knownIds.has(id)) ?? null
}

