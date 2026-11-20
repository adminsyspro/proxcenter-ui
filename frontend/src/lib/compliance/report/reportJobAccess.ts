// Read access to a background report job: Enterprise, the caller that started
// it, and the compliance right on its connection still held now.
import { NextResponse } from 'next/server'

import { getPrincipal, rejectionToResponse } from '@/lib/auth/principal'
import { requireEnterprise } from '@/lib/auth/requireEnterprise'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { getReportJob, reportJobOwnerKey, type ReportJob } from '@/lib/compliance/report/reportJobs'

export async function resolveOwnReportJob(
  jobId: string,
): Promise<{ ok: true; job: ReportJob } | { ok: false; response: Response }> {
  const entGuard = await requireEnterprise()
  if (entGuard) return { ok: false, response: entGuard }

  const principal = await getPrincipal()
  if (principal.ok === false) return { ok: false, response: rejectionToResponse(principal.rejection) }
  const ownerKey = principal.principal ? reportJobOwnerKey(principal.principal) : null
  if (!ownerKey) return { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }

  // Somebody else's job reads exactly like an expired one.
  const job = getReportJob(jobId, await getCurrentTenantId(), ownerKey)
  if (!job) return { ok: false, response: NextResponse.json({ error: 'report not found or expired' }, { status: 404 }) }

  const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE, 'connection', job.connectionId)
  if (denied) return { ok: false, response: denied }

  return { ok: true, job }
}
