import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.view permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Proxmox: GET /nodes/{node}/status
    const status = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/status`,
      { method: "GET" }
    )

    return NextResponse.json({ data: status })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

const VALID_NODE_COMMANDS = ["reboot", "shutdown"] as const

/**
 * POST /api/v1/connections/[id]/nodes/[node]/status
 *
 * Reboot or shutdown a node via PVE API: POST /nodes/{node}/status
 * Body: { command: "reboot" | "shutdown" }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: node.manage permission required
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)

    if (denied) return denied

    const body = await req.json().catch(() => ({}))
    const command = body?.command

    if (!command || !VALID_NODE_COMMANDS.includes(command)) {
      return NextResponse.json(
        { error: `Invalid command. Valid: ${VALID_NODE_COMMANDS.join(", ")}` },
        { status: 400 }
      )
    }

    const conn = await getConnectionById(id)

    // Proxmox: POST /nodes/{node}/status with command=reboot|shutdown
    const result = await pveFetch<string>(
      conn,
      `/nodes/${encodeURIComponent(node)}/status`,
      {
        method: "POST",
        body: new URLSearchParams({ command }),
      }
    )

    return NextResponse.json({ data: result })
  } catch (e: any) {
    console.error(`[node-status] POST Error:`, e?.message)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

