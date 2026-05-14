import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeIp } from "@/lib/ssh/node-ip"
import { executeSSH } from "@/lib/ssh/exec"
import { checkPermission, PERMISSIONS, buildNodeResourceId } from "@/lib/rbac"
import { assertNodeName, InvalidShellArgError } from "@/lib/ssh/validate"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; node: string }> }

/**
 * POST — Reboot a node after upgrade.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id, node: rawNode } = await ctx.params

  let node: string

  try {
    node = assertNodeName(rawNode)
  } catch (e) {
    if (e instanceof InvalidShellArgError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }

    throw e
  }

  const denied = await checkPermission(
    PERMISSIONS.NODE_MANAGE,
    "node",
    buildNodeResourceId(id, node)
  )

  if (denied) return denied

  const conn = await getConnectionById(id)

  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  const nodeIp = await getNodeIp(conn, node)

  // Use nohup so the SSH session returns before the reboot kills it
  const result = await executeSSH(id, nodeIp, "nohup bash -c 'sleep 1 && reboot' > /dev/null 2>&1 &")

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to reboot node" },
      { status: 500 }
    )
  }

  return NextResponse.json({ rebooting: true })
}
