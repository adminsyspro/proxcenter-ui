import { NextResponse } from "next/server"

import { licenseExcludedResponse } from "@/lib/api/response"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIaasTenantCeph } from "@/lib/ceph/tenantGuard"
import { assertNodeName } from "@/lib/ssh/validate"
import {
  classifyExporterError,
  fetchExporterMetrics,
  type ExporterFailure,
  getExporterPort,
  getNodeIps,
  parseAllOsdCounters,
  type OsdCounters,
} from "@/lib/ceph/exporter"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/*
   One reading of the per-OSD I/O counters of several Ceph nodes, for the OSD
   tables. Same rules as the per-node route: the addresses come from PVE
   (cached 5 minutes), 3 s and 5 MB per node, at most 4 nodes read at a time.
   A node that does not answer is `ok: false` with a `reason` (refused, timeout
   or invalid) and its OSDs are absent; it never fails the response. Raw errors
   never reach the client.
     200 { data: { at, nodes: { "<node>": { ok: true } | { ok: false, reason } }, osds: { "<id>": { node, ...counters } } } }
*/

const MAX_NODES = 20
const CONCURRENCY = 4

type Ctx = { params: Promise<{ id: string }> }

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied
    // Ceph is a whole-cluster object: an IaaS tenant gets 404, before any PVE call.
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    const raw = (new URL(req.url).searchParams.get("nodes") ?? "").split(",").map(n => n.trim()).filter(Boolean)
    const nodes = [...new Set(raw)]
    if (nodes.length === 0 || nodes.length > MAX_NODES) {
      return NextResponse.json({ error: `nodes must list between 1 and ${MAX_NODES} node names` }, { status: 400 })
    }
    try {
      for (const n of nodes) assertNodeName(n)
    } catch {
      return NextResponse.json({ error: "Invalid node name" }, { status: 400 })
    }

    const conn = await getConnectionById(id)
    const ips = await getNodeIps(id, () => pveFetch<unknown>(conn, "/cluster/status"))
    if (nodes.some(n => !ips.has(n))) {
      return NextResponse.json({ error: "Node not found in this connection" }, { status: 404 })
    }

    const port = await getExporterPort(id)
    const readings = await inBatches(nodes, CONCURRENCY, async node => {
      try {
        return { node, osds: parseAllOsdCounters(await fetchExporterMetrics(ips.get(node) as string, port)), reason: null }
      } catch (e) {
        return { node, osds: null, reason: classifyExporterError(e) }
      }
    })

    const nodesOut: Record<string, { ok: true } | { ok: false; reason: ExporterFailure }> = {}
    const osds: Record<string, { node: string } & OsdCounters> = {}
    for (const r of readings) {
      nodesOut[r.node] = r.osds !== null ? { ok: true } : { ok: false, reason: r.reason ?? "invalid" }
      if (r.osds) for (const [osd, c] of r.osds) osds[String(osd)] = { node: r.node, ...c }
    }

    return NextResponse.json({ data: { at: Date.now(), nodes: nodesOut, osds } })
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
