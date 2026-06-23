// GET /api/v1/compliance/frameworks/[frameworkId]/report?connectionId=
// Assesses one compliance framework for a connection, renders HTML,
// and streams the result as a PDF via the WeasyPrint sidecar.
import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireEnterprise } from '@/lib/auth/requireEnterprise'
import { verifyConnectionOwnership, getSessionPrisma, getCurrentTenantId } from '@/lib/tenant'
import { getSetting } from '@/lib/db/settings'
import { collectHardeningData } from '@/lib/compliance/collectHardeningData'
import { runAllChecks } from '@/lib/compliance/hardening'
import { FRAMEWORKS, getCrosswalk, getFramework } from '@/lib/compliance/frameworks'
import type { FrameworkId } from '@/lib/compliance/frameworks/types'
import { FRAMEWORK_LOGO_FILES } from '@/lib/compliance/frameworks/logos'
import { assessFramework } from '@/lib/compliance/frameworkAssessment'
import { computeNodeBreakdown } from '@/lib/compliance/nodeBreakdown'
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

    // Guard: connectionId required (cheap presence check first)
    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId required' }, { status: 400 })
    }

    // Guard 1: Enterprise-only feature (before exposing framework ID validity to non-enterprise callers)
    const entGuard = await requireEnterprise()
    if (entGuard) return entGuard

    // Guard: known frameworkId (after enterprise check to avoid info leak)
    if (!FRAMEWORKS.some(f => f.id === frameworkId)) {
      return NextResponse.json({ error: 'unknown framework' }, { status: 400 })
    }

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

    // Fetch branding settings server-side. Wrapped in try/catch so a DB or FS
    // hiccup never crashes the report; falls back to defaults.
    let brandColor = '#E57000'
    let logoDataUri = ''
    try {
      const tenantId = await getCurrentTenantId()
      const branding = await getSetting<any>('branding', tenantId)
      if (branding?.enabled && branding?.primaryColor) {
        brandColor = String(branding.primaryColor)
      }

      let logoPath = ''
      if (branding?.enabled && branding?.logoUrl) {
        // path.basename prevents any directory traversal in a stored URL
        const filename = path.basename(String(branding.logoUrl).split('?')[0])
        const candidate = path.join(process.cwd(), 'data', 'uploads', 'branding', tenantId, filename)
        if (fs.existsSync(candidate)) logoPath = candidate
      }
      if (!logoPath) {
        const def = path.join(process.cwd(), 'public', 'images', 'proxcenter.png')
        if (fs.existsSync(def)) logoPath = def
      }
      if (logoPath) {
        const mime = logoPath.endsWith('.svg')
          ? 'image/svg+xml'
          : (logoPath.endsWith('.jpg') || logoPath.endsWith('.jpeg'))
            ? 'image/jpeg'
            : 'image/png'
        logoDataUri = `data:${mime};base64,${fs.readFileSync(logoPath).toString('base64')}`
      }
    } catch {
      // Branding/logo failures are non-fatal; report renders with defaults.
    }

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

    // Framework badge, embedded as a base64 data URI (WeasyPrint runs with
    // base_url=None, so file/URL paths do not resolve). Non-fatal on failure.
    let frameworkLogoDataUri = ''
    try {
      const logoFile = FRAMEWORK_LOGO_FILES[def.id]
      if (logoFile) {
        const logoPath = path.join(process.cwd(), 'public', 'images', 'frameworks', logoFile)
        if (fs.existsSync(logoPath)) {
          frameworkLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
        }
      }
    } catch {
      // Missing/unreadable badge is non-fatal; report renders without it.
    }

    // Build HTML report
    // Literal-English translator: frameworkReportHtml calls t() with full dot-path keys
    // (e.g. 'compliance.frameworks.controlsAssessed'). getTranslations from next-intl
    // requires a request context that is not reliably available in Route handlers, so we
    // use a static map keyed by the suffix after 'compliance.frameworks.'.
    const EN_LABELS: Record<string, string> = {
      assessedOk: 'assessed OK',
      controlsAssessed: 'controls assessed',
      noAssessed: 'No controls assessed yet',
    }
    const reportT = (k: string): string => {
      const suffix = k.replace('compliance.frameworks.', '')
      return EN_LABELS[suffix] ?? k
    }
    const date = new Date().toISOString().slice(0, 10)
    const nodeBreakdown = computeNodeBreakdown(hardeningData)
    const html = frameworkReportHtml(
      assessment,
      def,
      {
        connectionName: conn.name ?? connectionId,
        generatedAt: date,
        locale: 'en',
        brandColor,
        logoDataUri,
        frameworkLogoDataUri,
      },
      reportT,
      nodeBreakdown,
    )

    // Render PDF via WeasyPrint sidecar
    const out = await renderPdf(html)
    if (!out.ok || !out.pdf) {
      return NextResponse.json({ error: out.error || 'PDF generation failed' }, { status: 503 })
    }

    const filename =
      sanitizeFilename(`${def.id}-${conn.name ?? connectionId}-${date}`) + '.pdf'

    return new NextResponse(new Uint8Array(out.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e: any) {
    console.error('[compliance/frameworks/report] Error:', e?.message)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
