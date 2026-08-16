// In-memory upload progress tracking (server-side only).
//
// Entries are owner-scoped: the upload id is a client-generated UUID and was
// the only thing standing between a signed-in user and someone else's upload
// counters (#699). The owner is the user who opened the transfer, stamped on
// the first chunk and kept for the later updates, so a reader who is not that
// user is told the id is unknown rather than being handed the entry.

export type UploadProgress = {
  bytesSent: number
  totalBytes: number
  status: "transferring" | "done" | "error"
  error?: string
}

type UploadEntry = {
  progress: UploadProgress
  /** User id that opened the transfer. Null = nobody can read it back. */
  ownerId: string | null
}

const uploads = new Map<string, UploadEntry>()

/**
 * Record progress for an upload.
 *
 * `ownerId` is resolved once, when the entry is created; the later calls of the
 * same transfer omit it and inherit the stamped owner, so a chunk loop never
 * pays for a second session lookup.
 */
export function setProgress(uploadId: string, progress: UploadProgress, ownerId?: string | null) {
  const existing = uploads.get(uploadId)

  uploads.set(uploadId, {
    progress,
    ownerId: ownerId ?? existing?.ownerId ?? null,
  })
}

/**
 * Read progress back for `ownerId`. Returns null for an unknown id AND for an
 * id owned by someone else: the caller answers both the same way, so the route
 * cannot be used to tell a live upload id from a made-up one.
 */
export function getProgress(uploadId: string, ownerId: string): UploadProgress | null {
  const entry = uploads.get(uploadId)

  if (!entry || !entry.ownerId || entry.ownerId !== ownerId) return null

  return entry.progress
}

export function clearProgress(uploadId: string) {
  uploads.delete(uploadId)
}
