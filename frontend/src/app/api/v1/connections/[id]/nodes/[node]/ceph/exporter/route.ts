import { NextResponse } from "next/server"

import { licenseExcludedResponse } from "@/lib/api/response"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIaasTenantCeph } from "@/lib/ceph/tenantGuard"
import { assertNodeName } from "@/lib/ssh/validate"
import { classifyExporterError, fetchExporterMetrics, getExporterPort, getNodeIps, parseOsdCounters } from "@/lib/ceph/exporter"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
   One reading of the per-OSD I/O counters of a Ceph node, taken from the
   ceph-exporter that runs on it (default port 9926, per connection). The
   counters are cumulative since the OSD started: the client derives rates from
   two readings. The node address comes from PVE `/cluster/status` (cached 5
   minutes), never from the request. Answers:
     200 { data: { osd, at, op_r, op_w, op_r_out_bytes, op_w_in_bytes } }
     503 { code: "exporter_unreachable", reason }  nothing answered, or not usable;
         reason = refused (nothing listens), timeout (no answer in time) or invalid
     404 { code: "osd_not_exported" }      the exporter does not report this OSD
   Raw errors never reach the client.
*/

type Ctx = { params: Promise<{ id: string; node: string }> }

const UNREACHABLE = { code: "exporter_unreachable", error: "The Ceph exporter of this node is not reachable" }
const NOT_EXPORTED = { code: "osd_not_exported", error: "This OSD is not reported by the exporter of this node" }

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id, node } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied
    // Ceph is a whole-cluster object: an IaaS tenant gets 404, before any PVE call.
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    let safeNode: string
    try {
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name" }, { status: 400 })
    }

    const rawOsd = new URL(req.url).searchParams.get("osd") ?? ""
    if (!/^\d{1,9}$/.test(rawOsd)) {
      return NextResponse.json({ error: "osd must be a non-negative integer" }, { status: 400 })
    }
    const osd = Number(rawOsd)

    const conn = await getConnectionById(id)
    const ips = await getNodeIps(id, () => pveFetch<unknown>(conn, "/cluster/status"))
    const ip = ips.get(safeNode)
    if (!ip) {
      return NextResponse.json({ error: "Node not found in this connection" }, { status: 404 })
    }

    let text: string
    try {
      text = await fetchExporterMetrics(ip, await getExporterPort(id))
    } catch (e) {
      return NextResponse.json({ ...UNREACHABLE, reason: classifyExporterError(e) }, { status: 503 })
    }

    const counters = parseOsdCounters(text, osd)
    if (!counters) return NextResponse.json(NOT_EXPORTED, { status: 404 })

    return NextResponse.json({ data: { osd, at: Date.now(), ...counters } })
  } catch (e: any) {
    const excluded = licenseExcludedResponse(e)
    if (excluded) return excluded
    if (isConnectionNotFoundError(e)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }
    console.error("[ceph/exporter] GET Error:", String(e?.message).replace(/[\r\n]/g, ""))
    return NextResponse.json({ error: "Failed to read the Ceph exporter" }, { status: 500 })
  }
}
