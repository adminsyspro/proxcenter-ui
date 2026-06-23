// GET /api/v1/compliance/frameworks/[frameworkId]/report?connectionId=
// Assesses one compliance framework for a connection, renders HTML,
// and streams the result as a PDF via the WeasyPrint sidecar.
import { NextResponse } from 'next/server'

import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireEnterprise } from '@/lib/auth/requireEnterprise'
import { verifyConnectionOwnership, getSessionPrisma } from '@/lib/tenant'
import { collectHardeningData } from '@/lib/compliance/collectHardeningData'
import { runAllChecks } from '@/lib/compliance/hardening'
import { FRAMEWORKS, getCrosswalk, getFramework } from '@/lib/compliance/frameworks'
import type { FrameworkId } from '@/lib/compliance/frameworks/types'
import { assessFramework } from '@/lib/compliance/frameworkAssessment'
import { frameworkReportHtml } from '@/lib/compliance/report/frameworkReportHtml'
import { sanitizeFilename } from '@/lib/compliance/report/escapeHtml'
import { renderPdf } from '@/lib/reporting/weasyprintClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ frameworkId: string }> }) {
  try {
    const { frameworkId } = await ctx.params
    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connectionId')

    // Guard: connectionId required
    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId required' }, { status: 400 })
    }

    // Guard: known frameworkId
    if (!FRAMEWORKS.some(f => f.id === frameworkId)) {
      return NextResponse.json({ error: 'unknown framework' }, { status: 400 })
    }

    // Guard 1: Enterprise-only feature
    const entGuard = await requireEnterprise()
    if (entGuard) return entGuard

    // Guard 2: Tenant ownership (mirrors Task 8 route)
    const ownershipError = await verifyConnectionOwnership(connectionId)
    if (ownershipError) return ownershipError

    // Guard 3: RBAC
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE, 'connection', connectionId)
    if (denied) return denied

    // Resolve connection
    const conn = await getConnectionById(connectionId)
    if (!conn) {
      return NextResponse.json({ error: 'connection not found' }, { status: 404 })
    }

    // Look up SSH setting (mirrors Task 8 route pattern)
    const prisma = await getSessionPrisma()
    const connectionRecord = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { sshEnabled: true },
    })

    // Collect raw data (no profile, mirrors Task 8)
    const hardeningData = await collectHardeningData({
      connectionId,
      conn,
      sshEnabled: !!connectionRecord?.sshEnabled,
    })

    // Run ALL checks (no profile, no weighting) and assess against the requested framework
    const checks = runAllChecks(hardeningData)
    const def = getFramework(frameworkId as FrameworkId)
    const assessment = assessFramework(checks, def, getCrosswalk(def.id))

    // Build HTML report
    const date = new Date().toISOString().slice(0, 10)
    const html = frameworkReportHtml(
      assessment,
      def,
      {
        connectionName: conn.name ?? connectionId,
        generatedAt: date,
        locale: 'en',
      },
      (k: string) => k, // i18n wired in Task 12
    )

    // Render PDF via WeasyPrint sidecar
    const out = await renderPdf(html)
    if (!out.ok || !out.pdf) {
      return NextResponse.json({ error: out.error || 'PDF generation failed' }, { status: 503 })
    }

    const filename =
      sanitizeFilename(`${def.id}-${conn.name ?? connectionId}-${date}`) + '.pdf'

    return new NextResponse(out.pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        // sanitizeFilename strips spaces, so no quoting is needed here.
        // Avoiding quotes keeps the header free of " chars (RFC 6266 allows unquoted tokens).
        'Content-Disposition': `attachment; filename=${filename}`,
      },
    })
  } catch (e: any) {
    console.error('[compliance/frameworks/report] Error:', e?.message)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
