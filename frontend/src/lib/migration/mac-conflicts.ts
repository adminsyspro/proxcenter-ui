/**
 * Duplicate check of the custom MACs a migration sets (ui#1330).
 *
 * One read of the target cluster: /etc/pve/nodes/* holds the config of every
 * VM and container of the cluster on every member (a replicated filesystem),
 * so a single grep on the target node answers for the whole cluster. Reading
 * each guest's config through the API instead would cost one pvedaemon call
 * per guest. The command is the one the sFlow agents already run
 * (lib/sflow/guestMacs), allowed by the same sudo rule.
 */

import { executeSSH } from "@/lib/ssh/exec"
import { GUEST_MACS_COMMAND, parseGuestMACs } from "@/lib/sflow/guestMacs"
import { getNodeSshEndpointForMigration } from "@/lib/migration/pve-tasks"

export type MacConflictCheck =
  | { ok: true; conflicts: Array<{ mac: string; vmid: number }> }
  | { ok: false; error: string }

/** The MACs of `macs` already set on a guest of the target cluster, with the guest that holds each. */
export async function findTargetMacConflicts(
  db: unknown,
  target: { connectionId: string; node: string; baseUrl: string },
  macs: string[],
): Promise<MacConflictCheck> {
  if (macs.length === 0) return { ok: true, conflicts: [] }
  try {
    const endpoint = await getNodeSshEndpointForMigration(db, target.connectionId, target.node, target.baseUrl)
    const result = await executeSSH(target.connectionId, endpoint, GUEST_MACS_COMMAND, 30_000, { readOnly: true })
    if (!result.success) return { ok: false, error: result.error || "SSH command failed" }
    const inUse = parseGuestMACs(result.output ?? "")
    const conflicts = macs.flatMap(mac => {
      const vmid = inUse[mac.toLowerCase()]
      return vmid === undefined ? [] : [{ mac, vmid }]
    })
    return { ok: true, conflicts }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
