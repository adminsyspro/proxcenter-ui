// src/lib/tenant/iaasGuard.ts
//
// An IaaS tenant rents a vDC slice of a provider cluster (pool, nodes,
// storages). It holds connection.view and node.view, and getConnectionById()
// hands it the provider connection through its vDC binding, so every route
// keyed by a connection is reachable by it. Routes that read or act on the
// cluster or a node as a whole (corosync config, node syslog, disks, apt,
// firewall of the datacenter, HA, SDN, replication...) therefore ask this
// guard, right after checkPermission() and before any PVE, database, SSH or
// orchestrator call:
//  - provider (tenant `default`): full access;
//  - msp: full access, its connections are its own clusters;
//  - iaas, or anything that cannot be resolved: 404 { error: "Not found" },
//    the resource does not exist for it and nothing is confirmed.
//
// The verdict is taken from the tenant the principal itself carries, never
// from getCurrentTenantId() (see requireProviderTenant in lib/tenant). Any
// error on the way refuses (fail closed). The classification of every
// connection route lives in src/lib/connections/iaasRoutePolicy.ts.

import { NextResponse } from "next/server"

import { getPrincipal, rejectionToResponse } from "@/lib/auth/principal"
import { prisma } from "@/lib/db/prisma"
import { userHasAccessToTenant } from "@/lib/tenant"
import { getTenantInfrastructureScope, type InfraScope } from "@/lib/tenant/infraScope"

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 })

export type CallerInfraScope =
  | { ok: true; infra: InfraScope; tenantId: string }
  | { ok: false; response: NextResponse }

/**
 * The infrastructure scope of the tenant the caller's principal carries, or
 * the Response to hand back: the principal rejection, 401 without a
 * principal, 404 Not found for a tenant that cannot be resolved (stale
 * session, disabled MSP tenant, lookup error). Object routes resolve the
 * full vDC union (default); a listing that follows the vDC view context, as
 * the connections list does, passes `ignoreVdcContext: false`.
 */
export async function resolveCallerInfraScope(
  opts: { ignoreVdcContext?: boolean } = {},
): Promise<CallerInfraScope> {
  try {
    const result = await getPrincipal()
    if (!result.ok) return { ok: false, response: rejectionToResponse(result.rejection) }
    const principal = result.principal
    if (!principal) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

    const tenantId = principal.tenantId
    if (!tenantId) return { ok: false, response: notFound() }

    // A session must still belong to the tenant it claims (stale JWT); a
    // token has no user, getPrincipal already refused a dead or disabled
    // tenant for it.
    if (principal.kind !== "token") {
      if (!principal.userId || !(await userHasAccessToTenant(principal.userId, tenantId))) {
        return { ok: false, response: notFound() }
      }
    }

    const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: opts.ignoreVdcContext ?? true })

    // A session of a disabled (or deleted) MSP tenant is not one any more.
    if (infra.kind === "msp" && principal.kind !== "token") {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { enabled: true } })
      if (!tenant?.enabled) return { ok: false, response: notFound() }
    }
    return { ok: true, infra, tenantId }
  } catch {
    return { ok: false, response: notFound() }
  }
}

/**
 * Null when the caller may read or act on a whole cluster or node (provider
 * or MSP tenant), else the Response to hand back (see resolveCallerInfraScope;
 * an IaaS tenant gets 404 Not found).
 */
export async function denyIaasTenant(): Promise<NextResponse | null> {
  const caller = await resolveCallerInfraScope()
  if (caller.ok === false) return caller.response
  if (caller.infra.kind === "provider" || caller.infra.kind === "msp") return null
  return notFound()
}
