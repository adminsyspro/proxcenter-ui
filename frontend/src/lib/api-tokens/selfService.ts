// Whether a customer tenant manages its own service accounts and API tokens
// (issue #1404). The provider opens it per tenant; until then, whatever its
// rights, nobody in that tenant, session or token, manages them. The provider
// tenant always does.
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import { SELF_SERVICE_CLOSED } from "./selfServiceMessage"

export { SELF_SERVICE_CLOSED }

export async function apiSelfServiceRefusal(tenantId: string): Promise<Response | null> {
  if (tenantId === DEFAULT_TENANT_ID) return null
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { apiSelfService: true } })
  return tenant?.apiSelfService ? null : NextResponse.json({ error: SELF_SERVICE_CLOSED }, { status: 403 })
}
