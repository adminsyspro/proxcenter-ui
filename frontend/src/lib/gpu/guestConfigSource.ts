// The one place the GPU inventory reads a VM config (#672): one /pending read
// per VM, which never throws. The inventory disk totals (#938) cache numbers,
// not configs, so there is nothing to share with them; a config cache, if one
// is ever added, only needs to be plugged in here.
//
// A plain /config read answers the pending values. A GPU released from a
// running VM is a pending delete only: the VM keeps the GPU until it stops,
// so the config read here keeps a hostpciN marked for deletion at its current
// value. Every other key follows the pending value, as /config does. Which
// hostpciN are in that state travels with the config (pendingDeleteOf), so the
// views can tell a GPU the VM still holds from one it will let go at its next
// stop.
import { pveFetch } from "@/lib/proxmox/client"

export type ReadQemuConfig = (
  connData: any,
  node: string,
  vmid: string,
) => Promise<Record<string, unknown> | null>

/** One row of /nodes/{node}/qemu/{vmid}/pending, as PVE returns it. */
export type PvePendingEntry = {
  key: string
  /** Current value. */
  value?: unknown
  /** Pending value. */
  pending?: unknown
  /** A pending delete when present and not 0 (2 = forced). */
  delete?: number | string
}

const HOSTPCI = /^hostpci\d+$/

const present = (v: unknown) => v !== undefined && v !== null

// The hostpciN kept at their current value while their removal is pending,
// keyed by the config object configFromPending built.
const pendingDeletes = new WeakMap<object, Set<string>>()

/** The hostpciN of a config read through configFromPending whose removal is pending. */
export function pendingDeleteOf(config: Record<string, unknown> | null | undefined): Set<string> {
  return (config && pendingDeletes.get(config)) || new Set()
}

/**
 * The config a VM holds for the GPU inventory, from its /pending rows: the
 * pending value of each key, a pending delete dropping the key, except that a
 * hostpciN marked for deletion keeps its current value until the VM stops.
 */
export function configFromPending(rows: PvePendingEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const kept = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row.key !== "string" || !row.key) continue
    const deleted = Number(row.delete ?? 0) > 0
    if (deleted) {
      if (HOSTPCI.test(row.key) && present(row.value)) {
        out[row.key] = row.value
        kept.add(row.key)
      }
      continue
    }
    if (present(row.pending)) out[row.key] = row.pending
    else if (present(row.value)) out[row.key] = row.value
  }
  pendingDeletes.set(out, kept)
  return out
}

const vmPath = (node: string, vmid: string) =>
  `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}`

async function readPlainConfig(connData: any, node: string, vmid: string): Promise<Record<string, unknown> | null> {
  try {
    const config = await pveFetch<Record<string, unknown>>(connData, `${vmPath(node, vmid)}/config`)
    return config && typeof config === "object" && !Array.isArray(config) ? config : null
  } catch {
    return null
  }
}

/** The config from /pending; /config when /pending cannot be read. */
export const readQemuConfig: ReadQemuConfig = async (connData, node, vmid) => {
  try {
    const rows = await pveFetch<unknown>(connData, `${vmPath(node, vmid)}/pending`)
    if (Array.isArray(rows)) return configFromPending(rows as PvePendingEntry[])
  } catch {
    // Fall through to the plain config.
  }
  return readPlainConfig(connData, node, vmid)
}
