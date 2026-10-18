import { NextResponse } from "next/server"

import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { CopyInterfacesNotFound, readVmCopyInterfaces } from "@/lib/vmware/copy-interfaces-server"
import { safeLog } from "@/lib/log/sanitize"

export const runtime = "nodejs"

/**
 * GET /api/v1/vmware/[id]/vms/[vmid]/copy-interfaces
 *
 * VMkernel adapters of the ESXi host the VM runs on, with their service tags
 * (roadmap#53). The warm migration dialog lists them so the operator can pin
 * the NFC copy traffic to a given adapter; `defaultDevice` is the one the copy
 * uses when nothing is chosen (the vSphereBackupNFC-tagged adapter, otherwise
 * management). `source` says whether the connection is a standalone host or a
 * vCenter, because the two steer the traffic differently (see warm-pipeline).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vmid: string }> }
) {
  try {
    const { id, vmid } = await params
    // Same rule as the migration it prepares: only a source the caller may
    // migrate from (a vDC tenant never, an MSP only its own connections), and
    // the permission is evaluated on that connection. 404 reveals nothing.
    const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
    if (!canMigrateConnections(infra, id)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(vmid)) {
      return NextResponse.json({ error: "Invalid VM reference" }, { status: 400 })
    }
    let ifaces
    try {
      ifaces = await readVmCopyInterfaces(prisma, id, vmid)
    } catch (e) {
      if (e instanceof CopyInterfacesNotFound) return NextResponse.json({ error: e.message }, { status: 404 })
      throw e
    }
    return NextResponse.json({
      data: {
        hostName: ifaces.hostName,
        source: ifaces.source,
        defaultDevice: ifaces.defaultDevice,
        vnics: ifaces.vnics.map(v => ({
          device: v.device, address: v.address, subnetMask: v.subnetMask, portgroup: v.portgroup, mtu: v.mtu, services: v.services,
        })),
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[vmware/copy-interfaces] Error:", safeLog(message))
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
