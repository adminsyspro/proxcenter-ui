export type SnapDeleteStatus = 'pending' | 'running' | 'done' | 'failed'

export interface DeleteSnapshotsResult {
  ok: boolean
  failed?: string
  error?: string
}

/**
 * Delete the given snapshots one at a time via the snapshot DELETE route with
 * ?wait=1 (each call blocks server-side until the PVE task finishes). Stops at
 * the first failure. Reports per-snapshot status transitions via onProgress.
 */
export async function deleteSnapshotsSequential(
  vmKey: string,
  names: string[],
  onProgress: (name: string, status: SnapDeleteStatus, error?: string) => void,
): Promise<DeleteSnapshotsResult> {
  for (const name of names) {
    onProgress(name, 'running')
    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots?name=${encodeURIComponent(name)}&wait=1`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const error = body?.error || `HTTP ${res.status}`
        onProgress(name, 'failed', error)
        return { ok: false, failed: name, error }
      }
      onProgress(name, 'done')
    } catch (e: any) {
      const error = e?.message || String(e)
      onProgress(name, 'failed', error)
      return { ok: false, failed: name, error }
    }
  }
  return { ok: true }
}
