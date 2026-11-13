import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, guestPerimeterAllows, PERMISSIONS } from "@/lib/rbac"
import { maskingScope } from "@/lib/tenant/infraScope"
import { resolveCallerInfraScope } from "@/lib/tenant/iaasGuard"
import { iaasMappingsView, iaasNodeAllowed } from "@/lib/connections/iaasView"
import { tenantPciMappings } from "@/lib/gpu/vdcGuard"

export const runtime = "nodejs"

const MAPPING_KINDS = new Set(["usb", "pci"])

// GET /api/v1/connections/{id}/cluster/mapping/{kind}?node={node}
// Datacenter resource mappings (PVE >= 8.0) of one kind. PVE already trims the
// list to the entries the connection's token may use, audit or modify. With
// `node`, PVE checks every mapping against that node and reports what it finds
// (`checks` for PCI, `error` for USB). A mapping is the only way a non-root
// caller, which every API token is, can attach a USB or PCI device to a VM
// (#852): PVE keeps devices given by their real hardware address to root@pam.
// A vDC tenant never sees a PCI mapping that covers a GPU, nor one the GPU
// collection could not judge: its GPUs come from the GPU section of its vDC,
// which draws on the contingent (#672).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; kind: string }> }
) {
  try {
    const { id, kind } = await ctx.params

    if (!MAPPING_KINDS.has(kind)) {
      return NextResponse.json({ error: `Unknown mapping kind: ${kind}` }, { status: 400 })
    }

    // A pool- or VM-scoped user edits VM hardware without holding any
    // connection resource, hence the guest-derived fallback (as cpu-models).
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)

    if (denied && !(await guestPerimeterAllows(id, PERMISSIONS.VM_VIEW))) return denied

    // An IaaS tenant gets the mappings that cover its vDC nodes, without the
    // host device addresses behind them (lib/connections/iaasView).
    const caller = await resolveCallerInfraScope()
    if (caller.ok === false) return caller.response
    const vdcScope = maskingScope(caller.infra)

    const conn = await getConnectionById(id)
    const node = new URL(req.url).searchParams.get("node")
    if (vdcScope && node && !iaasNodeAllowed(vdcScope, id, node)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const query = node ? `?check-node=${encodeURIComponent(node)}` : ""

    const raw = await pveFetch<unknown>(conn, `/cluster/mapping/${kind}${query}`)
    const list: any[] = Array.isArray(raw) ? raw : []

    if (!vdcScope) return NextResponse.json({ data: list })

    // GPU mappings are judged on the full rows, before the masked view drops their paths.
    const allowed = kind === "pci" ? ((await tenantPciMappings(id, list)) as any[]) : list

    return NextResponse.json({ data: iaasMappingsView(allowed, vdcScope, id) })
  } catch (e: any) {
    // The upstream text names the PVE host, which a vDC tenant must never see.
    console.error("[cluster-mapping] read failed:", e?.message)

    return NextResponse.json({ error: "pve_unreachable" }, { status: 502 })
  }
}
