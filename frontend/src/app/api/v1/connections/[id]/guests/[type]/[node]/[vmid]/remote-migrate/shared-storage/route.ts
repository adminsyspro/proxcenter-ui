import { NextResponse } from "next/server"

import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { inspectGuestConf } from "@/lib/migration/sharedHandover/guestConf"
import { guardHandoverRequest, readGuestConfText, sshReady } from "@/lib/migration/sharedHandover/server"
import { proveSharedStorages } from "@/lib/migration/sharedHandover/storageProof"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/remote-migrate/shared-storage
 *
 * Tells whether the guest can move to the target cluster without copying its
 * disks (ui#1460), by proving that a target storage holds them. The proof
 * allocates a 4 MiB probe volume on each source storage of the guest and
 * removes it before answering; nothing else changes.
 *
 * Body: { targetConnectionId, targetNode }
 *
 * `relevant`: the guest sits on a storage another cluster could reach, so the
 * option is worth showing. `eligible`: the move can run now; otherwise
 * `reasons` says why (SSH_SOURCE, SSH_TARGET, NOT_PORTABLE, STORAGE_NOT_SHARED).
 */
async function handler(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> },
) {
  try {
    const guard = await guardHandoverRequest(await req.json().catch(() => null), ctx)
    if (guard.ok !== true) return guard.response
    const { id, type, node, vmid, targetConnectionId, targetNode, sourceConn, targetConn } = guard.request

    const [sourceSsh, targetSsh] = await Promise.all([sshReady(id), sshReady(targetConnectionId)])
    const inspected = inspectGuestConf(await readGuestConfText(sourceConn, node, type, vmid, sourceSsh), type)

    const storages = await proveSharedStorages({
      source: { conn: sourceConn, node },
      target: { conn: targetConn, node: targetNode },
      vmid,
      type,
      volumes: inspected.volumes,
    })

    const relevant = storages.some(p => p.ok === true || (p.reason !== 'local-type' && p.reason !== 'no-candidate'))
    const reasons: string[] = []
    if (!sourceSsh) reasons.push('SSH_SOURCE')
    if (!targetSsh) reasons.push('SSH_TARGET')
    if (inspected.blockers.length > 0) reasons.push('NOT_PORTABLE')
    if (storages.some(p => !p.ok)) reasons.push('STORAGE_NOT_SHARED')

    return NextResponse.json({
      eligible: relevant && reasons.length === 0,
      relevant,
      reasons,
      storages,
      blockers: inspected.blockers.map(b => b.key),
      isos: inspected.isos.map(i => i.volid),
    })
  } catch (e: any) {
    console.error('[remote-migrate/shared-storage] Error:', String(e?.message || e).replace(/[\r\n]/g, ' '))

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const POST = withPublicApiGuard("vm-remote-migrate-shared-storage", handler)
