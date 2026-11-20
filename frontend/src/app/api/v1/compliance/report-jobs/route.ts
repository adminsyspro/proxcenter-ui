// POST /api/v1/compliance/report-jobs  { frameworkId, connectionId }
// Starts a framework report in the background and answers at once (202). The
// browser follows it on /api/v1/compliance/report-jobs/[jobId] and downloads
// the PDF from .../download once it is ready (lib/compliance/report/reportJobs).
import { NextResponse } from 'next/server'

import { getPrincipal, rejectionToResponse } from '@/lib/auth/principal'
import { getHardeningData } from '@/lib/compliance/collectionCache'
import { buildFrameworkReportPdf } from '@/lib/compliance/report/buildFrameworkReport'
import {
  E_TOO_MANY_REPORT_JOBS,
  MAX_REPORT_JOBS_PER_OWNER,
  publicReportJob,
  reportJobOwnerKey,
  startReportJob,
} from '@/lib/compliance/report/reportJobs'
import { resolveReportRequest } from '@/lib/compliance/report/reportRequest'
import { resolveReportBranding } from '@/lib/reporting/reportBranding'
import { runWithBackgroundTenant } from '@/lib/tenant/background'
import { safeLog } from '@/lib/log/sanitize'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const frameworkId = typeof body?.frameworkId === 'string' ? body.frameworkId : null
    const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : null

    // Every guard of the synchronous report, before anything is started.
    const request = await resolveReportRequest(frameworkId, connectionId)
    if ('response' in request) return request.response

    const principal = await getPrincipal()
    if (principal.ok === false) return rejectionToResponse(principal.rejection)
    const ownerKey = principal.principal ? reportJobOwnerKey(principal.principal) : null
    if (!ownerKey) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    // Read inside the request: both need its tenant, which the job no longer has.
    const branding = await resolveReportBranding()
    const { tenantId } = request

    const job = startReportJob({
      tenantId,
      ownerKey,
      frameworkId: request.frameworkId,
      connectionId: request.connectionId,
      connectionName: request.conn.name ?? request.connectionId,
      run: () => runWithBackgroundTenant(tenantId, async () => {
        const { data } = await getHardeningData({
          tenantId,
          connectionId: request.connectionId,
          conn: request.conn,
          sshEnabled: request.sshEnabled,
        })

        return buildFrameworkReportPdf({
          frameworkId: request.frameworkId,
          connectionId: request.connectionId,
          connectionName: request.conn.name,
          data,
          branding,
        })
      }),
    })

    return NextResponse.json({ data: publicReportJob(job) }, { status: 202 })
  } catch (e: any) {
    if (e?.message === E_TOO_MANY_REPORT_JOBS) {
      return NextResponse.json(
        { error: `At most ${MAX_REPORT_JOBS_PER_OWNER} reports can be generated at the same time.`, code: E_TOO_MANY_REPORT_JOBS },
        { status: 429 },
      )
    }
    console.error('[compliance/report-jobs] Error:', safeLog(e?.message))

    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

// Audited: who exported which compliance report of which connection.
export const POST = withAudit({ category: 'security', action: 'create', resourceType: 'compliance_report' }, handlePost)
