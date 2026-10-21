import { NextResponse } from "next/server"
import { licenseExcludedResponse } from "@/lib/api/response"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById, isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { assertNodeName } from "@/lib/ssh/validate"
import { withAudit } from "@/lib/audit/withAudit"
import { isDaemonId, parseCreateMonBody } from "@/lib/ceph/service"

export const runtime = "nodejs"

/*
   Create a Ceph monitor or manager on a node (ui#1164). One route, the `kind`
   of the body picks the PVE call:
     mon  POST /nodes/{node}/ceph/mon/{node}  optional mon-address
     mgr  POST /nodes/{node}/ceph/mgr/{node}
   Both carry the node's name, as the PVE GUI does, and answer a task UPID.
   No OSD creation: PVE refuses it to an API token ("Permission check failed
   (user != root@pam)", measured on PVE 9.2), and running it as root over SSH
   would sidestep that guard on purpose (product decision, 21/10/2026).
*/

type Ctx = { params: Promise<{ id: string; node: string }> }
const KINDS = ["mon", "mgr"] as const
type Kind = (typeof KINDS)[number]

function createError(e: any): NextResponse {
  const excluded = licenseExcludedResponse(e)
  if (excluded) return excluded
  console.error("[ceph/create] POST Error:", String(e?.message).replace(/[\r\n]/g, ""))
  if (isConnectionNotFoundError(e)) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }
  return NextResponse.json({ error: e?.message || "Failed to create the Ceph service" }, { status: 500 })
}

/** The PVE path and form body for one kind, or the 400 that refuses the body. */
function planCreate(kind: Kind, node: string, body: unknown): { path: string; params: Record<string, string> } | { error: string } {
  if (!isDaemonId(node)) {
    return { error: `The node name "${node}" cannot be used as a ${kind} id (letters, digits and dashes only)` }
  }
  const base = `/nodes/${encodeURIComponent(node)}/ceph`
  if (kind === "mon") {
    const parsed = parseCreateMonBody(body)
    if (parsed.ok === false) return { error: parsed.error }
    return { path: `${base}/mon/${encodeURIComponent(node)}`, params: parsed.params as Record<string, string> }
  }
  return { path: `${base}/mgr/${encodeURIComponent(node)}`, params: {} }
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/ceph/create
 * Body: { kind: 'mon' | 'mgr', 'mon-address'? }
 * Answers { data: { upid, node, kind } }.
 */
async function handlePost(req: Request, ctx: Ctx) {
  try {
    const { id, node } = await ctx.params
    let safeNode: string
    try {
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.STORAGE_ADMIN, "connection", id)
    if (denied) return denied

    const body = await req.json().catch(() => ({}))
    const kind = body?.kind
    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: "kind must be mon or mgr" }, { status: 400 })
    }
    const plan = planCreate(kind, safeNode, body)
    if ("error" in plan) return NextResponse.json({ error: plan.error }, { status: 400 })

    const conn = await getConnectionById(id)
    const upid = await pveFetch<string>(conn, plan.path, {
      method: "POST",
      body: new URLSearchParams(plan.params),
    })
    return NextResponse.json({ data: { upid, node: safeNode, kind } })
  } catch (e: any) {
    return createError(e)
  }
}

export const POST = withAudit({ category: "nodes", resourceType: "node", resourceParam: "node", action: "ceph_create" }, handlePost)
