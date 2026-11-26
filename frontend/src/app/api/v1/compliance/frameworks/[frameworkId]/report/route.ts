// GET /api/v1/compliance/frameworks/[frameworkId]/report?connectionId=
// Assesses one compliance framework for a connection, renders HTML,
// and streams the result as a PDF via the WeasyPrint sidecar. The Frameworks
// tab goes through the background report jobs instead (/api/v1/compliance/report-jobs);
// this route stays for API callers.
import { NextResponse } from 'next/server'

import { getHardeningData } from '@/lib/compliance/collectionCache'
import { buildFrameworkReportPdf } from '@/lib/compliance/report/buildFrameworkReport'
import { listRiskAcceptances } from '@/lib/compliance/riskAcceptance'
import { resolveReportRequest } from '@/lib/compliance/report/reportRequest'
import { resolveReportBranding } from '@/lib/reporting/reportBranding'
import { safeLog } from '@/lib/log/sanitize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ frameworkId: string }> }) {
  try {
    const { frameworkId } = await ctx.params
    const connectionId = new URL(req.url).searchParams.get('connectionId')

    const request = await resolveReportRequest(frameworkId, connectionId)
    if ('response' in request) return request.response

    // Branding (colour, logo, white-label name); never fatal.
    const branding = await resolveReportBranding()

    // Collect raw data (no profile), or reuse the collection another compliance screen just made
    const { data } = await getHardeningData({
      tenantId: request.tenantId,
      connectionId: request.connectionId,
      conn: request.conn,
      sshEnabled: request.sshEnabled,
    })

    const out = await buildFrameworkReportPdf({
      frameworkId: request.frameworkId,
      connectionId: request.connectionId,
      connectionName: request.conn.name,
      data,
      acceptances: await listRiskAcceptances(request.tenantId, request.connectionId),
      branding,
    })
    if ('error' in out) {
      return NextResponse.json({ error: out.error }, { status: 503 })
    }

    return new NextResponse(new Uint8Array(out.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${out.filename}"`,
      },
    })
  } catch (e: any) {
    console.error('[compliance/frameworks/report] Error:', safeLog(e?.message))
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
