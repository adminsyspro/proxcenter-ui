/**
 * Normalization helpers for the ZFS data PVE returns alongside a pool.
 */

/** ZFS prints this exact sentence when a pool is clean. */
const ZFS_NO_ERRORS = 'no known data errors'

/**
 * `scan` and `errors` are plain sentences from zpool, not structured objects,
 * so there is no `scan.progress` to read (measured on PVE 9.1). We surface the
 * sentence verbatim and derive a single boolean for colouring.
 */
export function summarizeScan(scan: unknown, errors: unknown): { label: string | null; hasErrors: boolean } {
  const scanText = typeof scan === 'string' && scan.trim() !== '' ? scan.trim() : null
  const errorsText = typeof errors === 'string' && errors.trim() !== '' ? errors.trim() : null

  let hasErrors = false

  if (scanText) {
    const m = /with (\d+) errors?/i.exec(scanText)

    if (m && Number(m[1]) > 0) hasErrors = true
  }

  if (errorsText && errorsText.toLowerCase() !== ZFS_NO_ERRORS) hasErrors = true

  return { label: scanText, hasErrors }
}
