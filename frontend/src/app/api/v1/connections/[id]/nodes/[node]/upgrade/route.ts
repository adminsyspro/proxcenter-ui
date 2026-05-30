import { NextResponse } from "next/server"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeIp } from "@/lib/ssh/node-ip"
import { executeSSH } from "@/lib/ssh/exec"
import { checkPermission, PERMISSIONS, buildNodeResourceId } from "@/lib/rbac"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; node: string }> }

/**
 * POST — Start a node upgrade via SSH (apt-get dist-upgrade).
 * The command runs in background (nohup) so the HTTP request returns immediately.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id, node } = await ctx.params

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

  let autoReboot = false
  try {
    const body = await req.json()
    autoReboot = !!body.auto_reboot
  } catch {
    // no body is fine
  }

  const nodeIp = await getNodeIp(conn, node)

  // Build the upgrade script
  // Status file: /tmp/.proxcenter-upgrade-status
  // Log file:    /tmp/.proxcenter-upgrade.log
  const rebootCmd = autoReboot
    ? `if [ -f /var/run/reboot-required ]; then echo REBOOTING > /tmp/.proxcenter-upgrade-status; sleep 2; reboot; fi`
    : ""

  const script = `nohup bash -c '
echo RUNNING > /tmp/.proxcenter-upgrade-status
rm -f /tmp/.proxcenter-upgrade.log
(apt-get update 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y 2>&1) >> /tmp/.proxcenter-upgrade.log 2>&1
if [ $? -eq 0 ]; then echo COMPLETED > /tmp/.proxcenter-upgrade-status; else echo FAILED > /tmp/.proxcenter-upgrade-status; fi
${rebootCmd}
' > /dev/null 2>&1 &`

  const result = await executeSSH(id, nodeIp, script)

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to start upgrade" },
      { status: 500 }
    )
  }

  return NextResponse.json({ started: true })
}

/**
 * GET — Poll the upgrade status + logs from the node.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { id, node } = await ctx.params

  const denied = await checkPermission(
    PERMISSIONS.NODE_VIEW,
    "node",
    buildNodeResourceId(id, node)
  )
  if (denied) return denied

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  const nodeIp = await getNodeIp(conn, node)

  const command = `cat /tmp/.proxcenter-upgrade-status 2>/dev/null || echo UNKNOWN; echo '---SEPARATOR---'; cat /tmp/.proxcenter-upgrade.log 2>/dev/null; echo '---SEPARATOR---'; test -f /var/run/reboot-required && echo YES || echo NO`

  const result = await executeSSH(id, nodeIp, command)

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to poll upgrade status" },
      { status: 500 }
    )
  }

  const parts = (result.output || "").split("---SEPARATOR---")
  const status = (parts[0] || "UNKNOWN").trim()
  const logs = (parts[1] || "").trim()
  const rebootRequired = (parts[2] || "NO").trim() === "YES"

  return NextResponse.json({
    status,
    logs,
    reboot_required: rebootRequired,
  })
}
