// The `jobIds` of a request that acts on some migrations of a batch (group
// cutover, change of the sync interval): either absent, for the whole batch,
// or a list of ids that must all belong to it.

/** Most ids a selection may name: the size of the largest batch. */
export const MAX_BATCH_SELECTION = 500

export type BatchSelection = { ok: true; selection: Set<string> | null } | { ok: false; error: string }

/** Read `jobIds` against the ids of the batch. `null` selects the whole batch. */
export function parseBatchSelection(jobIds: unknown, batchJobIds: readonly string[]): BatchSelection {
  if (jobIds === undefined || jobIds === null) return { ok: true, selection: null }
  if (!Array.isArray(jobIds) || jobIds.length === 0 || jobIds.length > MAX_BATCH_SELECTION || jobIds.some(v => typeof v !== "string" || v === "")) {
    return { ok: false, error: `jobIds must list between 1 and ${MAX_BATCH_SELECTION} migration ids` }
  }
  const known = new Set(batchJobIds)
  if (jobIds.some(v => !known.has(v))) return { ok: false, error: "jobIds must list migrations of this batch" }
  return { ok: true, selection: new Set(jobIds as string[]) }
}
