import { NextResponse } from "next/server"

import { resolveVisibleConnectionIds } from "@/lib/api-tokens/scope"
import type { Principal } from "@/lib/auth/principal"
import { prisma } from "@/lib/db/prisma"
import { checkPermission } from "@/lib/rbac"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

/**
 * sdn.vnet.* verdict of the /vdcs/{id}/vnets routes. A session keeps the
 * resource-less check: a connection-scoped one would refuse a holder whose
 * grant is scoped below the connection (#378 class).
 * An API token (perimeter "handler") reaches the vDCs of its own tenant only
 * (404 otherwise, as a session of another tenant gets; a provider token
 * mirrors a provider session), on a connection inside its perimeter, and is
 * judged on that connection.
 */
export async function checkVnetPermission(
  principal: Principal | undefined,
  vdcId: string,
  permission: string,
): Promise<Response | null> {
  if (principal?.kind !== "token") return checkPermission(permission)

  const vdc = await prisma.vdc.findUnique({ where: { id: vdcId }, select: { tenantId: true, connectionId: true } })
  if (!vdc || (principal.tenantId !== DEFAULT_TENANT_ID && vdc.tenantId !== principal.tenantId)) {
    return NextResponse.json({ error: "vDC not found" }, { status: 404 })
  }
  if (!(await resolveVisibleConnectionIds(principal)).has(vdc.connectionId)) {
    return NextResponse.json({ error: "Connection not in token scope", connection: vdc.connectionId }, { status: 403 })
  }
  return checkPermission(permission, "connection", vdc.connectionId)
}
