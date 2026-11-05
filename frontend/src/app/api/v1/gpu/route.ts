import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { vdcTenantDenied } from "@/lib/gpu/guard"
import { loadVisibleGpuReport } from "@/lib/gpu/visibleReport"

export const runtime = "nodejs"

/**
 * GET /api/v1/gpu?connId=<id>&node=<node>&refresh=1
 *
 * GPU inventory, GPU-to-VM allocation map and capacity of every connected PVE
 * cluster (#672, phase 1, read-only, Proxmox API only). `connId` narrows to
 * one cluster (the cluster view of the inventory), `node` to one node (the
 * node view), `refresh=1` bypasses the per-connection cache.
 *
 * Visibility: the devices and capacity of a node need node.view on it, the
 * identity of a VM needs vm.view on it. A vDC tenant gets a 404: GPUs are an
 * infrastructure concern of the provider and of the MSP tenants (#672).
 */
export async function GET(req: Request) {
  try {
    const vdc = await vdcTenantDenied()
    if (vdc) return vdc

    const deniedVm = await checkPermission(PERMISSIONS.VM_VIEW)
    if (deniedVm) {
      const deniedNode = await checkPermission(PERMISSIONS.NODE_VIEW)
      if (deniedNode) return deniedVm
    }

    const url = new URL(req.url)
    const report = await loadVisibleGpuReport({
      connId: url.searchParams.get("connId"),
      node: url.searchParams.get("node"),
      refresh: url.searchParams.get("refresh") === "1",
    })

    return NextResponse.json({ data: report })
  } catch (e: any) {
    console.error("[gpu] Error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
