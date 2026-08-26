import { executeSSH } from "@/lib/ssh/exec"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeIpForMigration } from "../pve-tasks"
import { prisma } from "@/lib/db/prisma"

/** Go/no-go for the NBD warm path: which of NBD_PREFLIGHT_TOOLS are absent. */
export interface NbdPreflightResult { ok: boolean; missing: string[]; error?: string }

/** Everything the XCP-ng warm reader needs on the Proxmox node. */
export const NBD_PREFLIGHT_TOOLS = ["nbdkit", "nbdkit-nbd-plugin", "nbd-client", "nbdinfo", "nbd-module"] as const

/**
 * Build a single probe command that prints one `tool=ok|missing` line per
 * dependency. The nbd plugin is probed by asking nbdkit to load it
 * (`nbdkit nbd --version`) rather than by looking for a file, so a plugin dir
 * that differs from ours still reports correctly. `nbd-module` covers the
 * kernel side: modprobe is a no-op when nbd is already loaded, and /dev/nbd0
 * only exists once it is. Pure; parsed by parseNbdPreflightOutput.
 */
export function buildNbdPreflightCmd(): string {
  return [
    `command -v nbdkit >/dev/null 2>&1 && echo nbdkit=ok || echo nbdkit=missing`,
    `nbdkit nbd --version >/dev/null 2>&1 && echo nbdkit-nbd-plugin=ok || echo nbdkit-nbd-plugin=missing`,
    `command -v nbd-client >/dev/null 2>&1 && echo nbd-client=ok || echo nbd-client=missing`,
    `command -v nbdinfo >/dev/null 2>&1 && echo nbdinfo=ok || echo nbdinfo=missing`,
    `(modprobe nbd 2>/dev/null; test -e /dev/nbd0) && echo nbd-module=ok || echo nbd-module=missing`,
  ].join("; ")
}

/** Parse the probe output: a tool is present only if its own `=ok` line is there. */
export function parseNbdPreflightOutput(output: string): NbdPreflightResult {
  const missing = NBD_PREFLIGHT_TOOLS.filter(t => !new RegExp(`^${t}=ok$`, "m").test(output))
  return { ok: missing.length === 0, missing: [...missing] }
}

/**
 * Check that the PVE node has the NBD toolchain the XCP-ng warm reader needs.
 * Returns a structured result rather than throwing, so the pipeline can surface
 * the actionable message to the operator before starting a migration.
 */
export async function checkNbdNodePreflight(connectionId: string, nodeIp: string): Promise<NbdPreflightResult> {
  const res = await executeSSH(connectionId, nodeIp, buildNbdPreflightCmd())
  if (!res.success) return { ok: false, missing: [], error: `NBD preflight probe could not run on ${nodeIp}: ${res.error || res.output}` }
  return parseNbdPreflightOutput(res.output || "")
}

/**
 * Pre-migration go/no-go for the XCP-ng warm path, surfaced in the migrate
 * dialog. Resolves the target node IP exactly as the warm engine does
 * (getNodeIpForMigration), so the dialog's verdict matches the backstop the
 * engine performs at planning time.
 */
export async function runXcpngWarmNodePreflight(connectionId: string, node: string): Promise<NbdPreflightResult> {
  const conn = await getConnectionById(connectionId)
  const nodeIp = await getNodeIpForMigration(prisma, connectionId, node, conn.baseUrl)
  return checkNbdNodePreflight(connectionId, nodeIp)
}
