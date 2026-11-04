/**
 * Display name of a PBS snapshot: its own notes, else the notes of its group.
 *
 * PVE writes a snapshot's notes from the job's notes template. A job without
 * one leaves every new snapshot nameless, and a note typed by hand on a
 * snapshot is lost when retention prunes it. PBS also keeps notes per backup
 * GROUP (its UI shows them on the group row), which survive both. The group
 * is identified by the exact same coordinates as the snapshot (datastore,
 * namespace, type, ID), so this fallback never borrows the name of another
 * guest that merely shares the VMID (the guess removed by ui#1030).
 */
import { pbsFetch } from "@/lib/proxmox/pbs-client"

type PbsSnapshotNameSource = {
  "backup-type"?: unknown
  "backup-id"?: unknown
  comment?: unknown
} | null | undefined

function noteText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function groupKey(backupType: unknown, backupId: unknown): string {
  return `${String(backupType ?? "")}/${String(backupId ?? "")}`
}

/**
 * First line of each group's notes in one namespace, keyed `type/id`.
 * Never throws: an older PBS, a missing privilege or a timeout only means no
 * fallback names, the snapshot listing itself must not fail on it.
 */
export async function fetchPbsGroupNotes(conn: any, store: string, ns: string): Promise<Map<string, string>> {
  const notes = new Map<string, string>()

  try {
    const nsParam = ns ? `?ns=${encodeURIComponent(ns)}` : ""
    const groups = await pbsFetch<any[]>(conn, `/admin/datastore/${encodeURIComponent(store)}/groups${nsParam}`)

    if (!Array.isArray(groups)) return notes

    for (const group of groups) {
      const note = noteText(group?.comment)
      if (!note || !group["backup-type"] || group["backup-id"] == null) continue
      notes.set(groupKey(group["backup-type"], group["backup-id"]), note)
    }
  } catch {
    // Fall back to snapshot notes only.
  }

  return notes
}

/** The snapshot's own notes when set, else the notes of its own group, else ''. */
export function pbsSnapshotName(snap: PbsSnapshotNameSource, groupNotes?: Map<string, string>): string {
  const own = noteText(snap?.comment)
  if (own) return own

  return groupNotes?.get(groupKey(snap?.["backup-type"], snap?.["backup-id"])) ?? ""
}
