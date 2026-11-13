import { pveFetch } from "@/lib/proxmox/client"

/**
 * The optional "start after migration" at the very end of a pipeline. By then
 * the copy is complete and the disks are attached, so a start that fails
 * leaves a finished migration whose VM is simply off: that is a warning with
 * the way forward, never a failed job that hides a good copy (discussion #1363).
 * Never throws. Returns whether PVE accepted the start.
 */
export async function startMigratedVm(a: {
  conn: any
  node: string
  vmid: number
  log: (msg: string, level: "success" | "warn") => Promise<unknown>
  /** The pipeline's own success line, kept as each pipeline already words it. */
  startedMessage: string
}): Promise<boolean> {
  const { conn, node, vmid, log } = a
  try {
    await pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`, { method: "POST" })
  } catch (e: any) {
    await log(
      `Migration complete, but VM ${vmid} could not be started: ${e?.message || e}. Its disks are attached and consistent: start it from Proxmox (node ${node}).`,
      "warn",
    ).catch(() => {})
    return false
  }
  await log(a.startedMessage, "success")
  return true
}
