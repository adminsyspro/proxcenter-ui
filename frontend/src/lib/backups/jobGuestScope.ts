import { NextResponse } from "next/server"

import { filterVmsByPermission, getRBACContext, PERMISSIONS } from "@/lib/rbac"

/**
 * Guests a backup job selects (issue #921).
 *
 * A caller who reaches a backup job route through a `storage` scope only (no
 * global or connection grant of the job permission) holds a right on the
 * destination, never on the guests. Without this check such a caller could
 * create or edit a job that backs up every guest of the cluster, or a whole
 * pool, onto the storage they were granted and read the archives from there.
 * They are held to jobs that name their guests one by one, each of them
 * carrying `vm.backup` for the caller, the right an on-demand backup needs.
 */
export type JobSelection = { mode: "all" | "pool" | "include"; vmids: string[] }

function splitVmids(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean)
  if (typeof raw === "string") return raw.split(",").map(s => s.trim()).filter(Boolean)
  return []
}

/**
 * Selection a job body asks for. An edit that leaves the selection alone
 * keeps the stored job's, read from its PVE fields (`all`, `pool`, `vmid`).
 */
export function jobSelection(body: any, stored?: any): JobSelection {
  const mode = body?.selectionMode
  if (mode === "all") return { mode: "all", vmids: [] }
  if (mode === "pool") return { mode: "pool", vmids: [] }
  if (mode === "include") return { mode: "include", vmids: splitVmids(body?.vmids) }
  if (stored) {
    if (String(stored.all) === "1") return { mode: "all", vmids: [] }
    if (stored.pool) return { mode: "pool", vmids: [] }
    return { mode: "include", vmids: splitVmids(stored.vmid) }
  }
  return { mode: "include", vmids: splitVmids(body?.vmids) }
}

type ClusterGuest = { vmid: number | string; node: string; type: string; tags?: string; pool?: string }

const deny = (detail: string) =>
  NextResponse.json({ error: `Permission denied: ${PERMISSIONS.VM_BACKUP}`, detail }, { status: 403 })

/**
 * 403 unless every guest of `selection` is named and carries `vm.backup` for
 * the caller. `guests` is the cluster's guest list (/cluster/resources?type=vm).
 */
export async function denyJobGuestsOutsideBackupRight(
  connId: string,
  selection: JobSelection,
  guests: ClusterGuest[],
): Promise<NextResponse | null> {
  if (selection.mode !== "include" || selection.vmids.length === 0) {
    return deny("A storage-scoped grant only covers jobs that name their guests one by one")
  }

  const ctx = await getRBACContext()
  const principal = ctx?.principal ?? ctx?.userId
  if (!principal) return deny("No caller")
  if (ctx?.isAdmin) return null

  const byVmid = new Map<string, ClusterGuest>()
  for (const g of guests) {
    if (g?.type === "qemu" || g?.type === "lxc") byVmid.set(String(g.vmid), g)
  }

  const wanted = [...new Set(selection.vmids)]
  const rows = wanted.map(vmid => {
    const g = byVmid.get(vmid)
    return g ? { connId, node: g.node, type: g.type, vmid, tags: g.tags, pool: g.pool } : null
  })
  // A guest that does not exist cannot be granted: refuse rather than tell
  // the caller which VMIDs exist.
  if (rows.some(r => r === null)) return deny("The job names a guest you cannot back up")

  const allowed = await filterVmsByPermission(principal, rows as NonNullable<(typeof rows)[number]>[], PERMISSIONS.VM_BACKUP, ctx?.tenantId)
  if (allowed.length !== rows.length) return deny("The job names a guest you cannot back up")
  return null
}
