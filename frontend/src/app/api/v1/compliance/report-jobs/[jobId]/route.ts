// GET /api/v1/compliance/report-jobs/[jobId]: state of one of the caller's background reports.
import { NextResponse } from 'next/server'

import { publicReportJob } from '@/lib/compliance/report/reportJobs'
import { resolveOwnReportJob } from '@/lib/compliance/report/reportJobAccess'
import { safeLog } from '@/lib/log/sanitize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await ctx.params
    const access = await resolveOwnReportJob(jobId)
    if ('response' in access) return access.response

    return NextResponse.json({ data: publicReportJob(access.job) })
  } catch (e: any) {
    console.error('[compliance/report-jobs/:id] Error:', safeLog(e?.message))

    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
