import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeIpForMigration } from "../pve-tasks"
import { prisma } from "@/lib/db/prisma"

/** Default VDDK libdir. Must match the warm engine default (warm-pipeline.ts). */
export const DEFAULT_VDDK_LIBDIR = "/usr/lib/vmware-vix-disklib"

export interface VddkPreflightResult {
  ok: boolean
  /** Keys of the dependencies that are absent (nbdkit, nbd-client, vddk-plugin, vddk-lib). */
  missing: string[]
  /** Human-actionable message when not ok (install commands, VDDK symlink hint). */
  error?: string
}

/** Install hint shown for each absent dependency. */
const HINTS: Record<string, string> = {
  "nbdkit": "apt install nbdkit",
  "nbd-client": "apt install nbd-client",
  // nbdkit-plugin-vddk lives in Debian non-free, which a stock PVE node doesn't
  // enable — so it's an admin prerequisite, not something "Prepare node(s)"
  // installs. Enable contrib/non-free in the node's apt sources, then install.
  "vddk-plugin": "nbdkit-plugin-vddk is in Debian non-free; enable contrib/non-free in the node's apt sources, then: apt install nbdkit-plugin-vddk",
  "vddk-lib":
    "install the Broadcom VDDK under <libdir>/lib64 (libvixDiskLib.so*); for VDDK 9.x, symlink libvixDiskLib.so.8 -> the installed .so.9 (nbdkit 1.42 dlopens the so.8 SONAME), or ship VDDK 8.0.x",
}

/**
 * Build a single probe command that prints `key=value` lines for each warm-
 * migration dependency on the PVE node:
 *   - nbdkit / nbd-client: `command -v` path, or MISSING
 *   - vddk-plugin: path to nbdkit-vddk-plugin.so, or empty
 *   - vddk-lib: path to libvixDiskLib.so* under <libdir>/lib64, or empty
 * Pure; parsed by parsePreflightOutput.
 */
export function buildPreflightCmd(libdir: string): string {
  const lib = shellEscape(libdir)
  return [
    `echo "nbdkit=$(command -v nbdkit || echo MISSING)"`,
    `echo "nbd-client=$(command -v nbd-client || echo MISSING)"`,
    `echo "vddk-plugin=$(find /usr/lib /usr/lib64 -name 'nbdkit-vddk-plugin.so' 2>/dev/null | head -1)"`,
    `echo "vddk-lib=$(ls ${lib}/lib64/libvixDiskLib.so* 2>/dev/null | head -1)"`,
  ].join("; ")
}

/** A value is "absent" if the probe reported MISSING or printed nothing. */
function absent(v: string | undefined): boolean {
  return !v || v.trim() === "" || v.trim() === "MISSING"
}

/** Parse the probe output into a structured preflight result with actionable hints. */
export function parsePreflightOutput(output: string, libdir: string): VddkPreflightResult {
  const map = new Map<string, string>()
  for (const line of output.split("\n")) {
    const i = line.indexOf("=")
    if (i > 0) map.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }
  const missing = ["nbdkit", "nbd-client", "vddk-plugin", "vddk-lib"].filter(k => absent(map.get(k)))
  if (missing.length === 0) return { ok: true, missing: [] }
  const error =
    `VDDK warm-migration preflight failed on the Proxmox node (libdir ${libdir}). Missing: ${missing.join(", ")}. ` +
    missing.map(k => `${k}: ${HINTS[k]}`).join("; ")
  return { ok: false, missing, error }
}

/**
 * Check that the PVE node has everything the warm migration needs: nbdkit,
 * its vddk plugin, nbd-client, and the Broadcom VDDK library under `libdir`.
 * Returns a structured result rather than throwing, so the pipeline can surface
 * the actionable message to the operator before starting a migration.
 */
export async function checkVddkPreflight(connectionId: string, nodeIp: string, libdir: string): Promise<VddkPreflightResult> {
  const res = await executeSSH(connectionId, nodeIp, buildPreflightCmd(libdir))
  if (!res.success) {
    return { ok: false, missing: [], error: `VDDK preflight probe could not run on ${nodeIp}: ${res.error || res.output}` }
  }
  return parsePreflightOutput(res.output || "", libdir)
}

/**
 * Pre-migration go/no-go for the warm path, surfaced in the migrate dialog.
 *
 * Resolves the target node IP exactly as runWarmMigration does
 * (getNodeIpForMigration + the same `vddkLibdir || default`) and runs
 * checkVddkPreflight, so the dialog's verdict matches the backstop the engine
 * performs at planning time. Node preparation itself is the operator's
 * responsibility (documented separately); this only reports readiness.
 */
export async function runWarmNodePreflight(
  connectionId: string,
  node: string,
  vddkLibdir?: string,
): Promise<VddkPreflightResult> {
  const conn = await getConnectionById(connectionId)
  const nodeIp = await getNodeIpForMigration(prisma, connectionId, node, conn.baseUrl)
  return checkVddkPreflight(connectionId, nodeIp, vddkLibdir || DEFAULT_VDDK_LIBDIR)
}
