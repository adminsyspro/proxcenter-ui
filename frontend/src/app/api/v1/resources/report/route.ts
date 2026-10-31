import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"
import { getDateLocale } from "@/lib/i18n/date"
import { locales } from "@/i18n/config"
import { getResourcesOverview } from "@/lib/resources/overviewBuilder"
import { capacityReportHtml, type ReportTranslator } from "@/lib/resources/capacityReportHtml"
import { sanitizeFilename } from "@/lib/compliance/report/escapeHtml"
import { resolveReportBranding } from "@/lib/reporting/reportBranding"
import { renderPdf } from "@/lib/reporting/weasyprintClient"
import { safeLog } from "@/lib/log/sanitize"
import { calculateImprovedPredictions } from "@/app/(dashboard)/infrastructure/resources/algorithms/improvedPrediction"
import { calculateHealthScoreWithDetails } from "@/app/(dashboard)/infrastructure/resources/algorithms/healthScore"
import { computeClusterRunway } from "@/app/(dashboard)/infrastructure/resources/algorithms/capacityPlanning"
import { DEFAULT_HISTORY_WINDOW_DAYS } from "@/app/(dashboard)/infrastructure/resources/algorithms/historyWindow"

export const runtime = "nodejs"

type Locale = (typeof locales)[number]

async function reportTranslator(locale: Locale): Promise<ReportTranslator> {
  const messages = (await import(`@/messages/${locale}.json`)).default as any
  const fallback = locale === 'en' ? messages : (await import('@/messages/en.json')).default as any
  const lookup = (bag: any, key: string) => key.split('.').reduce((node, part) => node?.[part], bag?.resources?.report)

  return (key, params) => {
    const template = lookup(messages, key) ?? lookup(fallback, key) ?? key

    return String(template).replace(/\{(\w+)\}/g, (_m, name) => (params && name in params ? String(params[name]) : `{${name}}`))
  }
}

/**
 * GET /api/v1/resources/report?connectionId=
 *
 * PDF capacity report of the scope shown on the resources page. It is drawn from
 * the overview snapshot (same 60 s cache), so it adds no Proxmox call when the
 * page was just loaded.
 */
export async function GET(request: Request) {
  try {
    const featureDenied = await requireFeature(Features.GREEN_METRICS)
    if (featureDenied) return featureDenied

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const tenantId = await getCurrentTenantId()
    const cookieStore = await cookies()
    const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value
    const locale: Locale = locales.includes(cookieLocale as Locale) ? cookieLocale as Locale : 'en'
    const dateLocale = getDateLocale(locale)
    const { searchParams } = new URL(request.url)
    const filterConnectionId = searchParams.get('connectionId') || undefined

    const { data } = await getResourcesOverview({ prisma, tenantId, filterConnectionId, dateLocale })
    const t = await reportTranslator(locale)

    // The connection filter only ever matches the tenant's own connections.
    const scopeName = filterConnectionId
      ? data.connections?.find((c: { id: string }) => c.id === filterConnectionId)?.name
      : t('allClusters')
    if (!scopeName) return NextResponse.json({ error: 'connection not found' }, { status: 404 })

    const trends = (data.trends ?? []).slice(-DEFAULT_HISTORY_WINDOW_DAYS)
    const { alerts } = calculateImprovedPredictions(data.kpis, trends, data.thresholds, undefined, dateLocale)
    const healthScore = calculateHealthScoreWithDetails(data.kpis, alerts, data.thresholds).score
    const clusters = (data.clusters ?? []).map((cluster: any) => {
      const { soonest } = computeClusterRunway(cluster, data.thresholds, DEFAULT_HISTORY_WINDOW_DAYS)

      return { ...cluster, runwayDays: soonest?.daysToThreshold ?? null, runwayResource: soonest?.resource ?? null }
    })

    const { brandColor, logoDataUri, appName } = await resolveReportBranding()
    const generatedAt = new Date().toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' })

    const html = capacityReportHtml({
      scope: scopeName,
      generatedAt,
      brandColor,
      logoDataUri,
      appName,
      healthScore,
      kpis: {
        cpuPct: data.kpis.cpu.used,
        ramPct: data.kpis.ram.used,
        storageUsed: data.kpis.storage.used,
        storageTotal: data.kpis.storage.total,
        vmsRunning: data.kpis.vms.running,
        vmsTotal: data.kpis.vms.total,
      },
      alerts,
      clusters,
      nodes: data.nodes ?? [],
      pools: data.storagePools ?? [],
      stopped: data.stoppedAllocation ?? { count: 0, vcpu: 0, ramBytes: 0, diskBytes: 0 },
      thresholds: data.thresholds,
    }, t)

    const out = await renderPdf(html)
    if (!out.ok || !out.pdf) {
      return NextResponse.json({ error: out.error || 'PDF generation failed' }, { status: 503 })
    }

    // A header value must stay ASCII: a cluster named "Datacenter Île-de-France" would throw.
    const filename = sanitizeFilename(`capacity-${scopeName}-${new Date().toISOString().slice(0, 10)}`).replace(/[^\x20-\x7E]/g, '') + '.pdf'

    return new NextResponse(new Uint8Array(out.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e: any) {
    console.error('[resources/report] Error:', safeLog(e?.message))

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
