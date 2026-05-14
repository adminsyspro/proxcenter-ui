// Delete a single PBS snapshot.
//
// PBS deletes via
//   DELETE /admin/datastore/{store}/snapshots
//     ?backup-type=...&backup-id=...&backup-time=...&ns=...
//
// Refuses to act on a protected snapshot — the caller must clear the
// `protected` flag first via the PBS UI / API. We let PBS surface that
// error verbatim instead of pre-flighting it ourselves; one round-trip
// less.

import { NextResponse } from 'next/server'

import { pbsFetch } from '@/lib/proxmox/pbs-client'
import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { assertVdcPbsAccess } from '@/lib/vdc/scope'
import { invalidatePbsBackupCache } from '@/lib/cache/pbsBackupCache'

export const runtime = 'nodejs'

export async function DELETE(
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

    // BACKUP_VIEW is the right gate for now — there's no separate
    // BACKUP_DELETE permission key in the RBAC enum. A future split
    // can refine this without changing the route shape.
    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, 'pbs', id)

    if (denied) return denied

    const access = await assertVdcPbsAccess(id)

    if (access instanceof Response) return access

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

    const qs = new URLSearchParams({
      'backup-type': backupType,
      'backup-id': vmid,
      'backup-time': String(Number(timestamp)),
    })

    if (ns) qs.set('ns', ns)

    await pbsFetch<unknown>(
      conn,
      `/admin/datastore/${encodeURIComponent(datastore)}/snapshots?${qs.toString()}`,
      { method: 'DELETE' },
    )

    // The page-level cache (server-side stale-while-revalidate) still
    // holds the now-deleted row — invalidate it so the next listing
    // fetch sees PBS reality. The browser-side request also passes
    // noCache=1 on its refresh after delete, so this is belt+braces.
    invalidatePbsBackupCache(id)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('PBS snapshot delete error:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
