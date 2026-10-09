// src/app/api/v1/guest-file-restore/jobs/[id]/route.ts
//
// One restore job, polled by the dialog. A queued/running row with no
// controller in this process and no update for two minutes is reported
// (and persisted) as interrupted.

import { NextResponse } from 'next/server'

import { requireGuestFileRestoreUser } from '@/lib/guestFileRestore/guard'
import { reconcileStaleJobs, toJobDto } from '@/lib/guestFileRestore/store'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'
import { getSessionPrisma } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const guard = await requireGuestFileRestoreUser()
  if (guard.denied) return guard.denied

  const { id } = await Promise.resolve(ctx.params)
  if (!id) return NextResponse.json({ error: 'Missing job id' }, { status: 400 })

  try {
    const db = await getSessionPrisma()
    const row = await db.guestFileRestoreJob.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, 'connection', row.connectionId)
    if (denied) return denied

    const [reconciled] = await reconcileStaleJobs([row])
    return NextResponse.json({ data: toJobDto(reconciled) })
  } catch (error: any) {
    console.error('Erreur GET guest-file-restore/jobs/[id]:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}
