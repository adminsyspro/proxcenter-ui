import { assertStorageName } from "@/lib/ssh/validate"
import { isGuestType, isNodeName, isVmid, type GuestTarget } from "@/lib/vdc/guestGuard"

export type RrdTarget = {
  /** The PVE path to query, rebuilt from validated segments. */
  path: string
  /** The guest the path addresses, null for a node or storage path. */
  guest: GuestTarget | null
}

function isStorageName(raw: string): boolean {
  try {
    assertStorageName(raw)
    return true
  } catch {
    return false
  }
}

/**
 * Rebuilds an RRD path from its validated segments. The RRD routes used to
 * append the caller's `path` to the PVE URL as is, so "/nodes/pve1/qemu/100/
 * config?x=" or a ".." segment reached any GET endpoint under /nodes/. Only
 * the shapes the UI draws are accepted (node, guest, storage); null = 400.
 */
export function canonicalRrdPath(raw: unknown): RrdTarget | null {
  if (typeof raw !== "string") return null
  const parts = raw.split("/").filter(Boolean)
  if (parts[0] !== "nodes" || !isNodeName(parts[1])) return null
  const node = parts[1]
  const base = `/nodes/${encodeURIComponent(node)}`
  if (parts.length === 2) return { path: base, guest: null }
  if (parts.length !== 4) return null
  const [, , kind, leaf] = parts
  if (isGuestType(kind) && isVmid(leaf)) {
    return { path: `${base}/${kind}/${encodeURIComponent(leaf)}`, guest: { type: kind, node, vmid: leaf } }
  }
  if (kind === "storage" && isStorageName(leaf)) {
    return { path: `${base}/storage/${encodeURIComponent(leaf)}`, guest: null }
  }
  return null
}
