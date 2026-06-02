/**
 * Display helpers for PBS backup snapshots shown in the inventory backup views.
 *
 * Dates are intentionally NOT formatted in this module: backup timestamps must
 * be rendered client-side (in the browser timezone) from the raw `backupTime`
 * epoch so the UI shows the real local time, the way native PVE does.
 * Formatting them server-side rendered the container's UTC clock instead, which
 * looked like the UTC stamp baked into the snapshot name (discussion #379).
 */

/**
 * Build the PBS snapshot name as shown by native PVE, e.g.
 * `ct/100/2026-06-01T20:24:43Z`. The timestamp portion is always UTC: it is the
 * identifier PBS stores on disk, not a localised date.
 */
export function buildPbsSnapshotName(
  backupType: string,
  backupId: string | number,
  backupTimeSec: number,
): string {
  if (!backupType || backupId === '' || backupId == null || !backupTimeSec) return ''
  const iso = new Date(backupTimeSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `${backupType}/${backupId}/${iso}`
}

/** Map a PBS backup type to the PVE "Format" label, e.g. `ct` -> `pbs-ct`. */
export function pbsFormatLabel(backupType: string): string {
  return backupType ? `pbs-${backupType}` : ''
}
