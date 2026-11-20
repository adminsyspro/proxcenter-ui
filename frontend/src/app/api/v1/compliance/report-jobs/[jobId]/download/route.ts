// GET /api/v1/compliance/report-jobs/[jobId]/download: the PDF of a finished background report.
import { NextResponse } from 'next/server'

import { resolveOwnReportJob } from '@/lib/compliance/report/reportJobAccess'
import { safeLog } from '@/lib/log/sanitize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await ctx.params
    const access = await resolveOwnReportJob(jobId)
    if ('response' in access) return access.response

    const { job } = access
    if (job.status !== 'done' || !job.pdf) {
      return NextResponse.json({ error: job.status === 'error' ? job.error : 'report not ready' }, { status: 409 })
    }

    return new NextResponse(new Uint8Array(job.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${job.filename ?? 'report.pdf'}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    console.error('[compliance/report-jobs/:id/download] Error:', safeLog(e?.message))

    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
