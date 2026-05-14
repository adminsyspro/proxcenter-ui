// Trigger a re-verification of a single PBS snapshot.
//
// PBS verifies the chunks of a snapshot via
//   POST /admin/datastore/{store}/verify
//     body: { backup-type, backup-id, backup-time, ns? }
// and returns a UPID the caller can poll. We forward the same UPID
// back to the frontend so it can be tracked via the existing PBS task
// machinery (the same place the verify status chip is updated from).

import { NextResponse } from 'next/server'

import { pbsFetch } from '@/lib/proxmox/pbs-client'
import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { assertVdcPbsAccess } from '@/lib/vdc/scope'

export const runtime = 'nodejs'

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; backupId: string }> | { id: string; backupId: string } },
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const rawBackupId = (params as any)?.backupId

    if (!id || !rawBackupId) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, 'pbs', id)

    if (denied) return denied

    const access = await assertVdcPbsAccess(id)

    if (access instanceof Response) return access

    // Same anchor-on-the-end parsing used elsewhere — sub-namespaces have
    // '/' so a left-aligned split misassigns the type/id/time tail.
    const decoded = decodeURIComponent(rawBackupId)
    const parts = decoded.split('/')

    if (parts.length < 4) {
      return NextResponse.json({ error: 'Invalid backupId format' }, { status: 400 })
    }

    const datastore = parts[0]
    const timestamp = parts[parts.length - 1]
    const vmid = parts[parts.length - 2]
    const backupType = parts[parts.length - 3]
    const namespaceFromId = parts.slice(1, parts.length - 3).join('/')

    const url = new URL(req.url)
    const ns = url.searchParams.get('ns') || namespaceFromId

    if (access.kind === 'tenant' && !access.allowed.some(a => a.datastore === datastore && a.namespace === ns)) {
      return NextResponse.json({ error: 'Backup not accessible for this tenant' }, { status: 403 })
    }

    const conn = access.kind === 'admin'
      ? await getPbsConnectionById(id)
      : await getPbsConnectionByIdUnscoped(id)

    const body: Record<string, any> = {
      'backup-type': backupType,
      'backup-id': vmid,
      'backup-time': Number(timestamp),
    }

    if (ns) body.ns = ns

    const upid = await pbsFetch<string>(
      conn,
      `/admin/datastore/${encodeURIComponent(datastore)}/verify`,
      { method: 'POST', body: JSON.stringify(body) },
    )

    return NextResponse.json({ data: upid, success: true })
  } catch (e: any) {
    console.error('PBS verify error:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
