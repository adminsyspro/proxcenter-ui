// GET /api/v1/admin/connections/{id}/storage-policies/{policyId}/disks:
// provider-only read of every existing disk this policy currently governs,
// across every VM in every vDC pool the policy is assigned to, with a
// per-disk drift flag: does the live drive line still carry the policy's
// current caps, or has it drifted since the policy was created/last edited
// (a cap changed after the disk was stamped, and the bulk apply hasn't run
// again yet). Powers the expandable policy row in
// StoragePoliciesSection.tsx (drift shown as a warning chip).
//
// Sequential, no streaming: unlike the sibling apply route this is a plain
// GET with nothing to progress-bar, and pool sizes at lab/production scale
// here (a handful of VMs per vDC) keep one config GET per VM well within a
// normal request timeout.
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { DATA_DISK_KEY_RE, parseDriveString, type DriveQosCaps } from "@/lib/vdc/drives"
import { enumerateQemuMembers } from "@/lib/vdc/storagePolicies"
import { mapCreateVdcError } from "@/lib/vdc/httpErrors"
import { safeLog } from "@/lib/log/sanitize"

import { storagePolicyProviderGuard } from "../../guard"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; policyId: string }> | { id: string; policyId: string } }

interface DiskDto {
  key: string
  iopsRd: number | null
  iopsWr: number | null
  mbpsRd: number | null
  mbpsWr: number | null
  inSync: boolean
}

interface VmDto {
  vmid: number
  name: string
  node: string
  vmstatus: string
  error?: true
  disks: DiskDto[]
}

/** Resolve the real owner tenantId of a connection, then re-fetch it scoped
 *  to that tenant: same pattern as lib/vdc/index.ts's
 *  getConnectionOwnerTenantId and the sibling apply route, so this
 *  provider-only read path reaches an MSP-owned connection without also
 *  needing a per-connection CONNECTION_VIEW grant (the session-scoped
 *  fleet-view check getConnectionById would otherwise run for a plain
 *  session tenantId lookup). */
async function getConnectionOwnerTenantId(connectionId: string): Promise<string> {
  const conn = await prisma.connection.findUnique({ where: { id: connectionId }, select: { tenantId: true } })
  if (!conn) throw new Error(`Connection not found: ${connectionId}`)
  return conn.tenantId
}

/** Read one QoS option (iops_rd, mbps_wr, ...) off a parsed drive's option
 *  list as a number, or null when the option is absent or unparseable. */
function capOrNull(opts: Array<[string, string]>, key: string): number | null {
  const entry = opts.find(([k]) => k === key)
  if (!entry) return null
  const n = Number(entry[1])
  return Number.isFinite(n) ? n : null
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id, policyId } = (await Promise.resolve(ctx.params)) as { id: string; policyId: string }
    const denied = await storagePolicyProviderGuard()
    if (denied) return denied

    const policy = await prisma.storagePolicy.findUnique({
      where: { id: policyId },
      select: {
        id: true, connectionId: true, storageId: true,
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

    if (poolNames.length === 0) {
      return NextResponse.json({ data: { vms: [] } })
    }

    const ownerTenantId = await getConnectionOwnerTenantId(id)
    const conn = await getConnectionById(id, ownerTenantId)

    const policyCaps: DriveQosCaps = {
      iopsRd: policy.iopsRd, iopsWr: policy.iopsWr, mbpsRd: policy.mbpsRd, mbpsWr: policy.mbpsWr,
    }

    const members = await enumerateQemuMembers(conn, poolNames)
    const vms: VmDto[] = []

    for (const member of members) {
      const configPath = `/nodes/${encodeURIComponent(member.node)}/qemu/${encodeURIComponent(member.vmid)}/config`
      let cfg: any
      try {
        cfg = await pveFetch<any>(conn, configPath)
      } catch (err: any) {
        console.warn(`[storage-policy-disks] policyId=${safeLog(policyId)} vmid=${safeLog(member.vmid)} config GET failed: ${safeLog(err?.message ?? err)}`)
        vms.push({ vmid: member.vmid, name: member.name, node: member.node, vmstatus: member.vmstatus, error: true, disks: [] })
        continue
      }

      const disks: DiskDto[] = []
      for (const [key, value] of Object.entries(cfg || {})) {
        if (!DATA_DISK_KEY_RE.test(key)) continue
        const raw = String(value ?? '')
        const parsed = parseDriveString(raw)
        if (parsed.ok === false || parsed.drive.storage !== policy.storageId) continue

        const opts = parsed.drive.opts
        const iopsRd = capOrNull(opts, 'iops_rd')
        const iopsWr = capOrNull(opts, 'iops_wr')
        const mbpsRd = capOrNull(opts, 'mbps_rd')
        const mbpsWr = capOrNull(opts, 'mbps_wr')
        disks.push({
          key,
          iopsRd,
          iopsWr,
          mbpsRd,
          mbpsWr,
          // Semantic comparison, never string equality: PVE re-serializes the
          // drive line with its options in alphabetical order, so a freshly
          // stamped line read back from the config differs byte-wise from
          // stampDriveQos output while carrying the exact same caps.
          inSync:
            iopsRd === policyCaps.iopsRd &&
            iopsWr === policyCaps.iopsWr &&
            mbpsRd === policyCaps.mbpsRd &&
            mbpsWr === policyCaps.mbpsWr,
        })
      }

      if (disks.length > 0) {
        vms.push({ vmid: member.vmid, name: member.name, node: member.node, vmstatus: member.vmstatus, disks })
      }
    }

    return NextResponse.json({ data: { vms } })
  } catch (e: any) {
    const { status, message } = mapCreateVdcError(e)
    return NextResponse.json({ error: message }, { status })
  }
}
