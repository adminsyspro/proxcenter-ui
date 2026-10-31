import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getDateLocale } from "@/lib/i18n/date"
import { getResourcesOverview } from "@/lib/resources/overviewBuilder"

export const runtime = "nodejs"

/**
 * GET /api/v1/resources/overview
 *
 * Capacity overview of the infrastructure: global KPIs, a year of daily trends,
 * per-cluster, per-node and per-pool capacity, top consumers, Green IT figures.
 * Cached 60 s per tenant, connection filter and locale (see getResourcesOverview).
 */
export async function GET(request: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const tenantId = await getCurrentTenantId()
    const cookieStore = await cookies()
    const dateLocale = getDateLocale(cookieStore.get('NEXT_LOCALE')?.value || 'en')
    const { searchParams } = new URL(request.url)
    const filterConnectionId = searchParams.get('connectionId') || undefined

    return NextResponse.json(await getResourcesOverview({ prisma, tenantId, filterConnectionId, dateLocale }))
  } catch (e: any) {
    console.error("[resources/overview] Error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
