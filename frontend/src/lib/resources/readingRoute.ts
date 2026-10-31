import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"
import { getDateLocale } from "@/lib/i18n/date"
import { normalizeLocale } from "@/lib/ai/locale"
import { safeLog } from "@/lib/log/sanitize"

import type { OverviewRequest } from "./overviewBuilder"

/** What an AI reading of the resources page is built from. */
export type ReadingRequest = OverviewRequest & { locale: string; scopeAll: string; refresh?: boolean }

/**
 * GET handler of an AI reading of the resources page (`?connectionId=&refresh=1`):
 * same gates as the page, locale from the UI cookie, 404 when the connection is
 * not one of the tenant's (the loader returns null).
 */
export function readingRoute<T>(label: string, load: (request: ReadingRequest) => Promise<T | null>) {
  return async function GET(request: Request) {
    try {
      const featureDenied = await requireFeature(Features.GREEN_METRICS)
      if (featureDenied) return featureDenied

      const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
      if (denied) return denied

      const locale = normalizeLocale((await cookies()).get('NEXT_LOCALE')?.value)
      const { searchParams } = new URL(request.url)

      const data = await load({
        prisma: await getSessionPrisma(),
        tenantId: await getCurrentTenantId(),
        filterConnectionId: searchParams.get('connectionId') || undefined,
        dateLocale: getDateLocale(locale),
        locale,
        scopeAll: 'all clusters',
        refresh: searchParams.get('refresh') === '1',
      })

      if (!data) return NextResponse.json({ error: 'connection not found' }, { status: 404 })

      return NextResponse.json({ data })
    } catch (e: any) {
      console.error(`[resources/${label}] Error:`, safeLog(e?.message))

      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
