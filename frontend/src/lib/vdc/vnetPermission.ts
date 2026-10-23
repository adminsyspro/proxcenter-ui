import { NextResponse } from "next/server"

import { resolveVisibleConnectionIds } from "@/lib/api-tokens/scope"
import type { Principal } from "@/lib/auth/principal"
import { prisma } from "@/lib/db/prisma"
import { checkPermission } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

/**
 * sdn.vnet.* verdict of the /vdcs/{id}/vnets routes. Every caller of a
 * tenant reaches the vDCs of its own tenant only: another tenant's vDC
 * answers the 404 of a missing one (no existence oracle); the provider
 * tenant keeps its fleet view.
 * A session keeps the resource-less check: a connection-scoped one would
 * refuse a holder whose grant is scoped below the connection (#378 class).
 * An API token (perimeter "handler") must also hit a connection inside its
 * perimeter, and is judged on that connection.
 */
export async function checkVnetPermission(
  principal: Principal | undefined,
  vdcId: string,
  permission: string,
): Promise<Response | null> {
  if (principal?.kind !== "token") return checkSessionVnetPermission(vdcId, permission)
  try {
    return await checkTokenVnetPermission(principal, vdcId, permission)
  } catch (e) {
    // Fail closed with a generic message: the lookup error stays in the logs.
    console.error("[vnets] token scope lookup failed, denying:", (e as Error)?.message ?? e)
    return NextResponse.json({ error: "Unable to verify token scope" }, { status: 503 })
  }
}

const VDC_NOT_FOUND = () => NextResponse.json({ error: "vDC not found" }, { status: 404 })

/** The vDC as seen from `tenantId`: null when missing or another tenant's (the provider sees them all). */
async function findVisibleVdc(tenantId: string, vdcId: string) {
  const vdc = await prisma.vdc.findUnique({ where: { id: vdcId }, select: { tenantId: true, connectionId: true } })
  if (!vdc || (tenantId !== DEFAULT_TENANT_ID && vdc.tenantId !== tenantId)) return null
  return vdc
}

async function checkSessionVnetPermission(vdcId: string, permission: string): Promise<Response | null> {
  const denied = await checkPermission(permission)
  if (denied) return denied
  try {
    // getCurrentTenantId fails closed on a stale or disabled tenant, so
    // 'default' here is a real member of the provider tenant (roadmap#79).
    const tenantId = await getCurrentTenantId()
    if (tenantId === DEFAULT_TENANT_ID) return null
    return (await findVisibleVdc(tenantId, vdcId)) ? null : VDC_NOT_FOUND()
  } catch (e) {
    console.error("[vnets] vDC tenant lookup failed, denying:", (e as Error)?.message ?? e)
    return NextResponse.json({ error: "Unable to verify vDC access" }, { status: 503 })
  }
}

async function checkTokenVnetPermission(principal: Principal, vdcId: string, permission: string): Promise<Response | null> {
  const vdc = await findVisibleVdc(principal.tenantId, vdcId)
  if (!vdc) return VDC_NOT_FOUND()
  if (!(await resolveVisibleConnectionIds(principal)).has(vdc.connectionId)) {
    return NextResponse.json({ error: "Connection not in token scope", connection: vdc.connectionId }, { status: 403 })
  }
  return checkPermission(permission, "connection", vdc.connectionId)
}
