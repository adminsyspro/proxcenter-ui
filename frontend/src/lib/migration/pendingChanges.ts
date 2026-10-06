// Configuration changes a guest has not applied yet (#926).
//
// GET /nodes/{node}/{qemu|lxc}/{vmid}/pending lists every config key with its
// current `value`, plus `pending` (the new value) or `delete` (the key goes
// away) for the changes that wait for the next restart. PVE does not refuse a
// migration because of them on its own: a live migration starts the target
// with the configuration the guest RUNS, so it fails when the pending change
// cannot be carried over (a new disk on a storage the target lacks, hardware
// the running guest does not have yet, ...). That is why the migrate dialogs
// only warn, and the task log says the rest.

export interface PendingChange {
  key: string
  /** Value in effect now, when there is one. */
  value?: string
  /** Value applied at the next restart. */
  pending?: string
  /** The key is removed at the next restart. */
  delete?: boolean
}

/** The entries of a PVE /pending answer that are actually pending. */
export function pendingChangesFromPve(rows: unknown): PendingChange[] {
  if (!Array.isArray(rows)) return []

  const changes: PendingChange[] = []
  for (const row of rows) {
    if (!row || typeof row.key !== 'string') continue
    const hasPending = row.pending !== undefined && row.pending !== null
    const deleted = Number(row.delete) > 0
    if (!hasPending && !deleted) continue
    changes.push({
      key: row.key,
      ...(row.value !== undefined && row.value !== null && { value: String(row.value) }),
      ...(hasPending && { pending: String(row.pending) }),
      ...(deleted && { delete: true }),
    })
  }

  return changes
}

export interface PendingCheckGuest {
  connId: string
  node: string
  type: string
  vmid: string | number
}

/** Pending changes of one guest through our route, or null when unknown (no right, error). */
export async function fetchPendingChanges(guest: PendingCheckGuest): Promise<PendingChange[] | null> {
  try {
    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(guest.connId)}/guests/${guest.type === 'lxc' ? 'lxc' : 'qemu'}` +
      `/${encodeURIComponent(guest.node)}/${encodeURIComponent(String(guest.vmid))}/migrate/pending-check`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const json = await res.json()

    return Array.isArray(json?.data?.changes) ? json.data.changes : null
  } catch {
    return null
  }
}
