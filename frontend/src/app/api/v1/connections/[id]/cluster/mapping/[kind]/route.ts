import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, guestPerimeterAllows, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

const MAPPING_KINDS = new Set(["usb", "pci"])

// GET /api/v1/connections/{id}/cluster/mapping/{kind}?node={node}
// Datacenter resource mappings (PVE >= 8.0) of one kind. PVE already trims the
// list to the entries the connection's token may use, audit or modify. With
// `node`, PVE checks every mapping against that node and reports what it finds
// (`checks` for PCI, `error` for USB). A mapping is the only way a non-root
// caller, which every API token is, can attach a USB or PCI device to a VM
// (#852): PVE keeps devices given by their real hardware address to root@pam.
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

    const conn = await getConnectionById(id)
    const node = new URL(req.url).searchParams.get("node")
    const query = node ? `?check-node=${encodeURIComponent(node)}` : ""

    const data = await pveFetch<unknown>(conn, `/cluster/mapping/${kind}${query}`)

    return NextResponse.json({ data: Array.isArray(data) ? data : [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
