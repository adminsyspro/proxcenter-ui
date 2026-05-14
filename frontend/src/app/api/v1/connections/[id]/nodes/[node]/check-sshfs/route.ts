import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeIp } from "@/lib/ssh/node-ip"
import { executeSSH } from "@/lib/ssh/exec"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { assertNodeName, InvalidShellArgError } from "@/lib/ssh/validate"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; node: string }> }

/**
 * GET — Check if sshfs is installed on a Proxmox node via SSH.
 * Uses "which sshfs" (whitelisted in orchestrator).
 * Returns { installed: boolean }
 */
export async function GET(_req: Request, ctx: Ctx) {
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

  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)

  if (denied) return denied

  const conn = await getConnectionById(id)

  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    const nodeIp = await getNodeIp(conn, node)
    const result = await executeSSH(id, nodeIp, "which sshfs")

    console.log("[check-sshfs]", node, "result:", JSON.stringify({ success: result.success, output: result.output?.trim(), error: result.error }))

    // "which sshfs" returns the path (e.g. /usr/bin/sshfs) on success, empty/error on failure
    const installed = result.success && !!result.output?.trim() && result.output.includes("sshfs")


return NextResponse.json({ data: { installed } })
  } catch (e: any) {
    console.error("[check-sshfs] Error:", e?.message || e)

return NextResponse.json({ data: { installed: false } })
  }
}
