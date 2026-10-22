import { executeSSH } from "@/lib/ssh/exec"
import { getConnectionById } from "@/lib/connections/getConnection"
import { prisma } from "@/lib/db/prisma"
import { getNodeSshEndpointForMigration } from "../pve-tasks"
import { conversionPreflightCommand, missingConversionPrereqs, virtV2vSupportOf } from "./guest-conversion"
import type { VirtV2vSupport } from "./virt-v2v-windows"

/** What the target node lacks to convert a guest at cutover (#1000), per guest family; empty lists when ready. */
export interface GuestConversionReadiness {
  linux: string[]
  windows: string[]
  /** The node's virt-v2v: the dialog warns about a Windows release it does not know (#1173). */
  virtV2v?: VirtV2vSupport
  /** The probe itself could not run; the engine checks again at cutover. */
  error?: string
}

/**
 * The warm dialog's view of the guest conversion prerequisites, on the node
 * the engine will use (same endpoint resolution as runWarmNodePreflight). The
 * probe only reads, so it also runs on a cluster outside the license. Never
 * throws: the conversion is optional and the engine re-checks at cutover.
 */
export async function checkGuestConversionNode(connectionId: string, node: string): Promise<GuestConversionReadiness> {
  try {
    const conn = await getConnectionById(connectionId)
    const nodeIp = await getNodeSshEndpointForMigration(prisma, connectionId, node, conn.baseUrl)
    const res = await executeSSH(connectionId, nodeIp, conversionPreflightCommand(), undefined, { readOnly: true })
    if (!res.success) return { linux: [], windows: [], error: res.error || "probe failed" }
    const out = res.output || ""
    return { linux: missingConversionPrereqs(out, false), windows: missingConversionPrereqs(out, true), virtV2v: virtV2vSupportOf(out) }
  } catch (e: any) {
    return { linux: [], windows: [], error: String(e?.message || e) }
  }
}
