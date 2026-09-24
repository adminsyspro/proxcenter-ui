import { NextResponse } from 'next/server'

import { clampDays, loadBackupRunsRaw, loadRunTaskDetail, MAX_DAYS } from '@/lib/backups/vzdumpRunsService'
import { filterBackupRunsForTenant, isTaskVisible, loadPoolByVmid, tenantMaySeeTaskDetail } from '@/lib/backups/vzdumpRunsTenant'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { getAllowedJobPools } from '@/lib/vdc/backupJobs'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ id: string; node: string; upid: string }>
}

/**
 * GET /api/v1/connections/[id]/backup-jobs/runs/[node]/[upid]?days=30
 *
 * One vzdump task of a backup run: status and log split per guest (#1003).
 * Unlike the generic task route (CONNECTION_VIEW only), a vDC tenant only gets
 * a task that belongs to a run it can see, otherwise 404. Visibility is checked
 * against the window the drawer shows (`days`, same cache entry as the list),
 * then the widest one if the task is not in it.
 */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { id, node, upid } = await ctx.params

    let decodedUpid: string
    try {
      decodedUpid = decodeURIComponent(upid)
    } catch {
      return NextResponse.json({ error: 'Malformed UPID' }, { status: 400 })
    }

    const parts = decodedUpid.split(':')
    if (parts[0] !== 'UPID' || parts[1] !== node || parts[5] !== 'vzdump') {
      return NextResponse.json({ error: 'Not a vzdump task of this node' }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_VIEW, 'connection', id)
    if (denied) return denied

    const conn = await getConnectionById(id)
    const allowedPools = await getAllowedJobPools(await getCurrentTenantId(), id)

    if (allowedPools !== null) {
      const days = clampDays(new URL(req.url).searchParams.get('days'))
      const poolByVmid = await loadPoolByVmid(conn)
      const visibleIn = async (window: number) =>
        isTaskVisible(filterBackupRunsForTenant(await loadBackupRunsRaw(conn, id, { days: window }), allowedPools, poolByVmid), node, decodedUpid)

      const visible = (await visibleIn(days)) || (days < MAX_DAYS && (await visibleIn(MAX_DAYS)))
      if (!visible) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

      // The history can be seconds old: check the log actually served too.
      const detail = await loadRunTaskDetail(conn, node, decodedUpid)
      if (!tenantMaySeeTaskDetail(detail, allowedPools, poolByVmid)) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }

      return NextResponse.json({ data: detail })
    }

    return NextResponse.json({ data: await loadRunTaskDetail(conn, node, decodedUpid) })
  } catch (e: any) {
    console.error('[backup-jobs/runs/task] GET Error:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
