/*
   Whether a PVE error means "this cluster has no Ceph" (not installed, or
   installed but not initialized), as opposed to a real failure. A 501 from
   PVE says it; so do the messages of a node without the Ceph packages or
   without `pveceph init`.
*/

const ABSENT_MESSAGE = /not (yet )?(installed|initialized|configured)|binary not installed/i

export function isCephAbsentError(e: unknown): boolean {
  const err = e as { statusCode?: unknown; message?: unknown } | null
  if (err?.statusCode === 501) return true
  return ABSENT_MESSAGE.test(String(err?.message ?? ''))
}
