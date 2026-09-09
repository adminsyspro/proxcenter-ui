import { NextResponse } from "next/server"

import { audit } from "@/lib/audit"
import { getConnectionById } from "@/lib/connections/getConnection"
import {
  captureHaResource,
  captureReplicationJobs,
  deleteGuestSnapshots,
  findSiteRecoveryJobsForGuest,
  markReplicationJobsForRemoval,
  removeHaResource,
  waitForReplicationJobsGone,
  type CcmPrereqCapture,
} from "@/lib/migration/ccm-prereqs"
import { pveFetch } from "@/lib/proxmox/client"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { assertVmid, assertNodeName } from "@/lib/ssh/validate"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, canMigrateConnections } from "@/lib/tenant/infraScope"

export const runtime = "nodejs"

type PrepareBody = {
  removeHa?: boolean
  removeReplication?: boolean
  /** Explicit snapshot names. The route refuses names absent from the guest. */
  removeSnapshots?: string[]
}

/** Capture reversible prerequisites before clearing the explicitly requested blockers. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> },
) {
  let capture: CcmPrereqCapture | undefined
  const cleared = { ha: false, replicationJobs: [] as string[], snapshots: [] as string[] }
  const pending = { replicationJobs: [] as string[] }

  try {
    const { id, type, node, vmid } = await ctx.params
    if (type !== 'qemu') {
      return NextResponse.json(
        { error: "Cross-cluster migration is currently only supported for QEMU VMs, not LXC containers" },
        { status: 400 },
      )
    }

    let safeVmid: string
    let safeNode: string
    try {
      safeVmid = assertVmid(vmid)
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name or vmid" }, { status: 400 })
    }

    const resourceId = buildVmResourceId(id, safeNode, type, safeVmid)
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, "vm", resourceId)
    if (denied) return denied

    const body: PrepareBody = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      (body.removeHa !== undefined && typeof body.removeHa !== 'boolean') ||
      (body.removeReplication !== undefined && typeof body.removeReplication !== 'boolean') ||
      (body.removeSnapshots !== undefined && (!Array.isArray(body.removeSnapshots) ||
        !body.removeSnapshots.every(name => typeof name === 'string' && name.length > 0)))) {
      return NextResponse.json({ error: "Invalid prerequisite removal request" }, { status: 400 })
    }
    const { removeHa = false, removeReplication = false } = body
    const snapshotNames = [...new Set(body.removeSnapshots || [])]

    // Snapshot deletion is irreversible: require the dedicated permission too.
    if (snapshotNames.length > 0) {
      const deniedSnap = await checkPermission(PERMISSIONS.VM_SNAPSHOT, "vm", resourceId)
      if (deniedSnap) return deniedSnap
    }

    // HA and replication are cluster-level configuration objects, matching the
    // existing /connections/[id]/ha and /nodes/[node]/replication routes.
    if (removeHa || removeReplication) {
      const deniedNode = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", id)
      if (deniedNode) return deniedNode
    }

    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    if (!canMigrateConnections(infra, id)) {
      return NextResponse.json(
        { error: 'Migration is restricted to the provider or the MSP tenant that owns this connection' },
        { status: 403 },
      )
    }

    const conn = await getConnectionById(id)
    const vmSid = 'vm:' + safeVmid
    const ha = await captureHaResource(conn, vmSid)
    const replication = await captureReplicationJobs(conn, safeVmid)
    capture = { ha, replication, snapshotsDeleted: [] }

    if (snapshotNames.length > 0) {
      const snapshots = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(safeNode)}/qemu/${safeVmid}/snapshot`)
      const available = new Set((Array.isArray(snapshots) ? snapshots : []).map(s => s?.name))
      const invalid = snapshotNames.filter(name => name === 'current' || !available.has(name))
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Cannot delete snapshot(s) ${invalid.join(', ')}: names must exist on this guest and cannot be current` },
          { status: 400 },
        )
      }
    }

    const auditRemoval = (details: Record<string, unknown>) => audit({
      action: 'delete',
      category: 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { connectionId: id, node: safeNode, ...details },
    })

    if (removeHa && capture.ha) {
      await removeHaResource(conn, vmSid)
      cleared.ha = true
      await auditRemoval({ prerequisite: 'ha', sid: vmSid })
    }

    if (removeReplication) {
      // Track each successful removal even if a subsequent job fails.
      for (const job of capture.replication) {
        const { marked, alreadyGone } = await markReplicationJobsForRemoval(conn, [job.id])
        cleared.replicationJobs.push(...marked, ...alreadyGone)
        pending.replicationJobs.push(...marked)
        if (marked.length > 0) await auditRemoval({ prerequisite: 'replication', jobId: job.id })
      }
    }

    const snapshots = await deleteGuestSnapshots(conn, safeNode, type, safeVmid, snapshotNames)
    cleared.snapshots = snapshots.deleted
    capture.snapshotsDeleted = snapshots.deleted
    for (const name of snapshots.deleted) {
      await auditRemoval({ prerequisite: 'snapshots', name })
    }

    // ⚠️ This budget MUST stay well under nginx's `proxy_read_timeout 60s` on
    // `location /` (nginx/proxcenter-locations.conf). A longer wait is cut off in
    // production, the client gets a 504 and LOSES the capture it needs to restore
    // or roll back, even though the removals succeeded. pvescheduler runs about
    // once a minute, so a slower removal simply comes back as `pending` and the
    // caller re-runs the preflight until it clears.
    pending.replicationJobs = await waitForReplicationJobsGone(conn, pending.replicationJobs, { timeoutMs: 30_000 })
    const warnings = pending.replicationJobs.map(jobId =>
      `Proxmox is still removing replication job ${jobId} in the background. Migration stays blocked until it finishes.`,
    )

    // A job still queued for removal is NOT cleared. Reporting it in both lists
    // would have the same response claim it is done and pending at once.
    cleared.replicationJobs = cleared.replicationJobs.filter(jobId => !pending.replicationJobs.includes(jobId))

    if (snapshots.failed) {
      return NextResponse.json(
        { error: `Could not delete snapshot ${snapshots.failed.name}: ${snapshots.failed.error}`, capture, cleared, pending },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, capture, cleared, pending, warnings })
  } catch (e: any) {
    const error = e?.message || String(e)
    console.error('[remote-migrate/prepare] Error:', String(error).replace(/[\r\n]/g, ''))
    return NextResponse.json({ error, ...(capture ? { capture, cleared, pending } : {}) }, { status: 500 })
  }
}

/**
 * GET /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/remote-migrate/prepare
 *
 * The prerequisites as they stand on the SOURCE guest, with no target involved.
 *
 * HA, replication and snapshots are properties of the guest, not of the
 * migration: making the user pick a cluster, a node, a storage and a bridge
 * before learning the migration is impossible anyway is backwards. The full
 * preflight (../check) still owns everything that genuinely depends on the
 * target: CPU model, MTU, storage capacity, VMID collision.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> },
) {
  try {
    const { id, type, node, vmid } = await ctx.params
    if (type !== 'qemu') {
      return NextResponse.json({ ha: null, replication: [], snapshots: [], siteRecoveryJobs: [] })
    }

    let safeVmid: string
    let safeNode: string
    try {
      safeVmid = assertVmid(vmid)
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name or vmid" }, { status: 400 })
    }

    const denied = await checkPermission(
      PERMISSIONS.VM_MIGRATE,
      "vm",
      buildVmResourceId(id, safeNode, type, safeVmid),
    )
    if (denied) return denied

    const conn = await getConnectionById(id)

    // Each read degrades on its own: a guest with no HA resource must not hide
    // its snapshots, and vice versa.
    const [ha, replication, snapshots, siteRecoveryJobs] = await Promise.all([
      captureHaResource(conn, `vm:${safeVmid}`).catch(() => null),
      captureReplicationJobs(conn, safeVmid).catch(() => []),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(safeNode)}/qemu/${safeVmid}/snapshot`)
        .then(list => (Array.isArray(list) ? list : [])
          .map(s => String(s?.name || ''))
          .filter(name => name && name !== 'current'))
        .catch(() => [] as string[]),
      // Advisory only, and deliberately not a prerequisite: a Site Recovery job
      // can cover several guests, so it is never cleared on their behalf.
      findSiteRecoveryJobsForGuest(id, safeVmid),
    ])

    return NextResponse.json({ ha, replication, snapshots, siteRecoveryJobs })
  } catch (e: any) {
    console.error('[remote-migrate/prepare] GET error:', String(e?.message || e).replace(/[\r\n]/g, ''))

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
