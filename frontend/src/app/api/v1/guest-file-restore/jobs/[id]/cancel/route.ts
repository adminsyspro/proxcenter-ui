// src/app/api/v1/guest-file-restore/jobs/[id]/cancel/route.ts
//
// Cancel a queued or running job. When the runner lives in this process its
// controller is aborted and the runner writes the final row; otherwise (a
// row orphaned by a restart, or another replica) the row is closed here.

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { requireGuestFileRestoreUser } from '@/lib/guestFileRestore/guard'
import { cancelGuestFileRestoreJob } from '@/lib/guestFileRestore/runner'
import { toJobDto } from '@/lib/guestFileRestore/store'
import { GUEST_FILE_RESTORE_TERMINAL_STATUSES } from '@/lib/guestFileRestore/types'
import type { GuestFileRestoreJobStatus, GuestFileRestoreLogLine } from '@/lib/guestFileRestore/types'
import { PERMISSIONS, buildVmResourceId, checkPermission } from '@/lib/rbac'
import { getSessionPrisma } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const guard = await requireGuestFileRestoreUser()
  if (guard.denied) return guard.denied

  const { id } = await Promise.resolve(ctx.params)
  if (!id) return NextResponse.json({ error: 'Missing job id' }, { status: 400 })

  try {
    const db = await getSessionPrisma()
    const row = await db.guestFileRestoreJob.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const denied = await checkPermission(
      PERMISSIONS.BACKUP_RESTORE,
      'vm',
      buildVmResourceId(row.connectionId, row.node, row.guestType, String(row.vmid)),
    )
    if (denied) return denied

    if (GUEST_FILE_RESTORE_TERMINAL_STATUSES.includes(row.status as GuestFileRestoreJobStatus)) {
      return NextResponse.json({ error: `Cannot cancel a ${row.status} job` }, { status: 400 })
    }

    if (cancelGuestFileRestoreJob(id)) {
      // The runner finalises the row; the dialog sees `cancelled` on its next poll.
      return NextResponse.json({ data: toJobDto(row) })
    }

    const now = new Date()
    const log = Array.isArray(row.log) ? (row.log as unknown as GuestFileRestoreLogLine[]) : []
    const updated = await prisma.guestFileRestoreJob.update({
      where: { id },
      data: {
        status: 'cancelled',
        currentPath: null,
        completedAt: now,
        log: [...log, { at: now.toISOString(), level: 'warn', msg: 'Cancelled by the operator' }].slice(-200),
      },
    })
    return NextResponse.json({ data: toJobDto(updated) })
  } catch (error: any) {
    console.error('Erreur POST guest-file-restore/jobs/[id]/cancel:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}
