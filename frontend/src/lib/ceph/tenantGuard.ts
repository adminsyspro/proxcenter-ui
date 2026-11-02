// src/lib/ceph/tenantGuard.ts
//
// Ceph is a whole-cluster object: OSDs, hosts, pools, mon/mgr addresses, CRUSH
// map, per-OSD IOPS. An IaaS tenant only rents a vDC slice of a provider
// cluster, yet it holds connection.view and getConnectionById() hands it the
// provider connection through its vDC binding. Every Ceph route therefore asks
// this guard, right after checkPermission() and before any PVE, database, SSH
// or orchestrator call:
//  - provider (tenant `default`): full access;
//  - msp: full access, its connections are its own clusters;
//  - iaas, or anything that cannot be resolved: 404 { error: "Not found" },
//    the feature does not exist for it and nothing is confirmed.
//
// The verdict is taken from the tenant the principal itself carries, never
// from getCurrentTenantId() (see requireProviderTenant in lib/tenant). Any
// error on the way refuses (fail closed).

import { NextResponse } from "next/server"

import { getPrincipal, rejectionToResponse } from "@/lib/auth/principal"
import { prisma } from "@/lib/db/prisma"
import { userHasAccessToTenant } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"

import { cephVisibleTo } from "./tenantVisibility"

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 })

/**
 * Null when the caller may read or act on Ceph (provider or MSP tenant), else
 * the Response to hand back: the principal rejection, 401 without a principal,
 * 404 Not found for an IaaS tenant or an unresolvable tenant.
 */
export async function denyIaasTenantCeph(): Promise<NextResponse | null> {
  try {
    const result = await getPrincipal()
    if (!result.ok) return rejectionToResponse(result.rejection)
    const principal = result.principal
    if (!principal) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

    const tenantId = principal.tenantId
    if (!tenantId) return notFound()

    // A session must still belong to the tenant it claims (stale JWT); a
    // token has no user, getPrincipal already refused a dead or disabled
    // tenant for it.
    if (principal.kind !== "token") {
      if (!principal.userId || !(await userHasAccessToTenant(principal.userId, tenantId))) return notFound()
    }

    const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
    if (!cephVisibleTo(infra)) return notFound()
    if (infra.kind === "provider") return null

    // A session of a disabled (or deleted) MSP tenant is not one any more.
    if (principal.kind !== "token") {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { enabled: true } })
      if (!tenant?.enabled) return notFound()
    }
    return null
  } catch {
    return notFound()
  }
}

/**
 * The same verdict as a boolean, for a caller that does not answer an HTTP
 * request with it (the assistant's tool context, the Ceph fields of an
 * aggregated response): true only when the gate lets the caller through.
 * denyIaasTenantCeph never throws (its errors are a 404), so neither does this.
 */
export async function cephAllowedForCaller(): Promise<boolean> {
  return (await denyIaasTenantCeph()) === null
}
