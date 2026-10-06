import { NextResponse } from "next/server"
import { getConnectionById } from "@/lib/connections/getConnection"
import { resolveNodeSshEndpoint } from "@/lib/ssh/node-endpoint"
import { executeSSH } from "@/lib/ssh/exec"
import { checkPermission, PERMISSIONS, buildNodeResourceId } from "@/lib/rbac"
import { verifyNodeTarget, sshTargetError } from "@/lib/ssh/verify-node-target"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; node: string }> }

// Both files live under /var/log: on PVE 9 (Debian 13) /tmp is a tmpfs, so the
// reboot that follows a kernel update used to wipe the only record of what apt
// printed (adminsyspro/proxcenter-ui discussion #928).
const STATUS_FILE = "/var/log/proxcenter-upgrade.status"
const LOG_FILE = "/var/log/proxcenter-upgrade.log"

// Exits 0 when the node needs a reboot. PVE never creates
// /var/run/reboot-required (no update-notifier-common), so the reliable signal
// is a newer installed kernel than the running one. No single quotes: it is
// embedded in the single-quoted upgrade script.
const REBOOT_REQUIRED_TEST =
  `{ test -f /var/run/reboot-required || { L=$(ls /boot/vmlinuz-* 2>/dev/null | sed "s|^/boot/vmlinuz-||" | sort -V | tail -n 1); [ -n "$L" ] && [ "$L" != "$(uname -r)" ]; }; }`

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

  const nodeIp = await resolveNodeSshEndpoint(conn, node)

  const check = await verifyNodeTarget(id, conn, node, nodeIp)
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status })
  }

  // Only a successful apt run may reboot: rebooting after a failure would turn
  // FAILED into REBOOTING, then into COMPLETED once the node is back. A run
  // that reboots writes REBOOTING directly, never COMPLETED first, or a poll in
  // between would make the dialog send its own reboot. If reboot itself fails,
  // the run is still a success that leaves the reboot to the operator.
  const successCmd = autoReboot
    ? `if ${REBOOT_REQUIRED_TEST}; then echo REBOOTING > ${STATUS_FILE}; sleep 2; reboot || echo COMPLETED > ${STATUS_FILE}; else echo COMPLETED > ${STATUS_FILE}; fi`
    : `echo COMPLETED > ${STATUS_FILE}`

  // RUNNING is written before the background job starts, so the first poll
  // can never read the outcome of a previous run.
  // A locally modified conffile (e.g. a customised zabbix_agent2.conf) makes
  // dpkg ask which version to keep. Nobody can answer in the background, so
  // without confdef/confold dpkg leaves that package unconfigured and apt
  // exits non-zero. Keep the local file, as dpkg's own default and the
  // Rolling Update do.
  const script = `echo RUNNING > ${STATUS_FILE}; rm -f ${LOG_FILE}; nohup bash -c '
(apt-get update 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold dist-upgrade 2>&1) >> ${LOG_FILE} 2>&1
if [ $? -eq 0 ]; then ${successCmd}; else echo FAILED > ${STATUS_FILE}; fi
' > /dev/null 2>&1 &`

  const result = await executeSSH(id, nodeIp, script)

  if (!result.success) {
    return NextResponse.json(
      { error: sshTargetError(node, nodeIp, result.error || "Failed to start upgrade") },
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

  const nodeIp = await resolveNodeSshEndpoint(conn, node)

  // REBOOTING is the last thing an auto-reboot run writes. Once the node is
  // back (booted after that write), the run is over: report COMPLETED, or the
  // dialog would poll a status that never moves again.
  const readStatus = `S=$(cat ${STATUS_FILE} 2>/dev/null || echo UNKNOWN); if [ "$S" = REBOOTING ] && [ $(( $(date +%s) - $(stat -c %Y ${STATUS_FILE}) )) -gt $(cut -d. -f1 /proc/uptime) ]; then S=COMPLETED; fi; echo "$S"`

  const command = `${readStatus}; echo '---SEPARATOR---'; cat ${LOG_FILE} 2>/dev/null; echo '---SEPARATOR---'; if ${REBOOT_REQUIRED_TEST}; then echo YES; else echo NO; fi`

  const result = await executeSSH(id, nodeIp, command)

  if (!result.success) {
    return NextResponse.json(
      { error: sshTargetError(node, nodeIp, result.error || "Failed to poll upgrade status") },
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
