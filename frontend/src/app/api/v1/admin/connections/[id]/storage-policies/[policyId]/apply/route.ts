// POST /api/v1/admin/connections/{id}/storage-policies/{policyId}/apply:
// provider-only bulk re-stamp of a storage policy's QoS onto every existing
// disk on its storage, across every VM in every vDC pool the policy is
// assigned to. Driven from the policy edit dialog after a caps change, so
// existing disks pick up the new caps instead of staying pinned to the
// values they were created with (restampGuestDrives otherwise only fires
// on the next clone/restore/rollback for a given guest).
//
// Streams NDJSON progress (start/vm*/done, one line each) rather than a
// single JSON body: re-stamping is sequential per VM (one GET+PUT round
// trip against PVE each) and can take a while across a large pool, so the
// dialog drives a live progress bar off the stream instead of blocking on
// a single request/response.
//
// qemu only: the pool-member filter below excludes lxc by construction
// (restampGuestDrives's DATA_DISK_KEY_RE only matches qemu drive keys
// anyway, so an lxc guest would just come back "unchanged" every time).
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { getConnectionById } from "@/lib/connections/getConnection"
import { restampGuestDrives } from "@/lib/vdc/driveGuard"
import type { DriveQosCaps } from "@/lib/vdc/drives"
import { enumerateQemuMembers } from "@/lib/vdc/storagePolicies"
import { mapCreateVdcError } from "@/lib/vdc/httpErrors"
import { audit } from "@/lib/audit"
import { safeLog } from "@/lib/log/sanitize"

import { storagePolicyProviderGuard } from "../../guard"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; policyId: string }> | { id: string; policyId: string } }

/** Resolve the real owner tenantId of a connection, then re-fetch it scoped
 *  to that tenant: same pattern as lib/vdc/index.ts's
 *  getConnectionOwnerTenantId, so this provider-only write path reaches an
 *  MSP-owned connection without also needing a per-connection CONNECTION_VIEW
 *  grant (the session-scoped fleet-view check getConnectionById would
 *  otherwise run for a plain session tenantId lookup). */
async function getConnectionOwnerTenantId(connectionId: string): Promise<string> {
  const conn = await prisma.connection.findUnique({ where: { id: connectionId }, select: { tenantId: true } })
  if (!conn) throw new Error(`Connection not found: ${connectionId}`)
  return conn.tenantId
}

function ndjson(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`
}

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const { id, policyId } = (await Promise.resolve(ctx.params)) as { id: string; policyId: string }
    const denied = await storagePolicyProviderGuard()
    if (denied) return denied

    const policy = await prisma.storagePolicy.findUnique({
      where: { id: policyId },
      select: {
        id: true, name: true, connectionId: true, storageId: true,
        iopsRd: true, iopsWr: true, mbpsRd: true, mbpsWr: true,
      },
    })
    if (!policy || policy.connectionId !== id) {
      return NextResponse.json({ error: "Storage policy not found" }, { status: 404 })
    }

    const assignments = await prisma.vdcStoragePolicy.findMany({
      where: { policyId },
      select: { vdc: { select: { pvePoolName: true } } },
    })
    const poolNames = Array.from(new Set(assignments.map((a) => a.vdc.pvePoolName)))

    const headers = { 'Content-Type': 'application/x-ndjson' }

    if (poolNames.length === 0) {
      const body = ndjson({ type: 'start', total: 0 }) + ndjson({ type: 'done', updated: 0, unchanged: 0, errors: 0 })
      return new Response(body, { headers })
    }

    const ownerTenantId = await getConnectionOwnerTenantId(id)
    const conn = await getConnectionById(id, ownerTenantId)

    const caps: DriveQosCaps = {
      iopsRd: policy.iopsRd, iopsWr: policy.iopsWr, mbpsRd: policy.mbpsRd, mbpsWr: policy.mbpsWr,
    }
    const policies = new Map<string, DriveQosCaps>([[policy.storageId, caps]])

    const members = await enumerateQemuMembers(conn, poolNames)
    const total = members.length

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(ndjson(obj)))
        send({ type: 'start', total })

        let updated = 0
        let unchanged = 0
        let errors = 0

        for (let i = 0; i < members.length; i++) {
          const member = members[i]
          const configPath = `/nodes/${encodeURIComponent(member.node)}/qemu/${encodeURIComponent(member.vmid)}/config`
          const logTag = `[storage-policy-apply] policyId=${safeLog(policyId)} vmid=${safeLog(member.vmid)}`
          try {
            const { stamped } = await restampGuestDrives({ conn, configPath, policies, logTag })
            if (stamped.length > 0) updated++
            else unchanged++
            send({
              type: 'vm', index: i, total, vmid: member.vmid, name: member.name, node: member.node,
              vmstatus: member.vmstatus, disks: stamped, status: stamped.length > 0 ? 'updated' : 'unchanged',
            })
          } catch (err: any) {
            errors++
            send({
              type: 'vm', index: i, total, vmid: member.vmid, name: member.name, node: member.node,
              vmstatus: member.vmstatus, disks: [], status: 'error', message: safeLog(err?.message ?? err),
            })
          }
        }

        await audit({
          action: "update",
          category: "settings",
          resourceType: "storage-policy",
          resourceId: policy.id,
          resourceName: policy.name,
          details: { connectionId: id, applied: true, updated, errors },
          status: "success",
        })

        send({ type: 'done', updated, unchanged, errors })
        controller.close()
      },
    })

    return new Response(stream, { headers })
  } catch (e: any) {
    const { status, message } = mapCreateVdcError(e)
    return NextResponse.json({ error: message }, { status })
  }
}
