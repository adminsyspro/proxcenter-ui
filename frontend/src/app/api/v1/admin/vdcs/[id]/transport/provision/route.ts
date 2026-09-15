import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { audit } from "@/lib/audit"
import { getVdcTransportStatus, provisionVdcTransport } from "@/lib/vdc/transportOps"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

async function gate(ctx: RouteContext): Promise<{ id: string } | Response> {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  if (!id) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  return { id }
}

function fail(e: any): NextResponse {
  const msg = e?.message || String(e)
  if (msg.startsWith("vDC not found")) return NextResponse.json({ error: "vDC not found" }, { status: 404 })
  if (msg.startsWith("VXLAN transport")) return NextResponse.json({ error: msg }, { status: 400 })
  return NextResponse.json({ error: msg }, { status: 502 })
}

// GET /api/v1/admin/vdcs/[id]/transport/provision
// What each node of the transport network carries on the VLAN interface,
// against what the stored transport asks for (#899). Nothing is written.
export async function GET(_req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    return NextResponse.json({ data: { nodes: await getVdcTransportStatus(g.id) } })
  } catch (e: any) {
    return fail(e)
  }
}

// POST /api/v1/admin/vdcs/[id]/transport/provision
// Create or update the transport VLAN interface on each node of the vDC's
// transport network, then reload that node's network (#899). Per-node
// results; a failing node never hides the others.
export async function POST(_req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const results = await provisionVdcTransport(g.id)
    const failed = results.filter((r) => r.action === "error").length

    await audit({
      action: "update",
      category: "settings",
      resourceType: "vdc",
      resourceId: g.id,
      resourceName: g.id,
      details: { operation: "transport-provision", results },
      status: failed === 0 ? "success" : "failure",
    })

    return NextResponse.json({ data: { results } })
  } catch (e: any) {
    return fail(e)
  }
}
