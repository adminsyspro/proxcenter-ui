// Cancellation of a long copy command on the PVE node. A command that copies
// or scans a disk runs as one SSH exec for minutes, and for hours under a low
// copy rate cap (copy-rate.ts): the pipeline only saw a cancellation once it
// returned. The watch checks the job's in-memory cancel flag (no Proxmox call)
// and stops the command's processes on the node when it is set.

/** How often the in-memory cancel flag is checked while a command runs. */
export const CANCEL_POLL_MS = 2_000

// Device paths as the pipelines build them (/dev/nbdN, /dev/<vg>/<lv>, /dev/zvol/...):
// anything else is left out rather than put in a pkill pattern.
const DEVICE_RE = /^\/dev\/[A-Za-z0-9/_.-]+$/

/**
 * Stop what reads `devices`: the checksum loop scanning one (its `: scan=<dev>`
 * marker, see buildBlockChecksumCmd) and the dd reading one. Each pattern
 * starts with a one-character class so pkill never matches the shell that
 * runs it. Always succeeds.
 */
export function buildStopCopyCmd(devices: string[]): string {
  const parts: string[] = []
  for (const d of devices) {
    if (!DEVICE_RE.test(d)) continue
    parts.push(`pkill -f '[s]can=.?${d}([^0-9]|$)' 2>/dev/null`, `pkill -f '[d]d if=${d} ' 2>/dev/null`)
  }
  parts.push("true")
  return parts.join("; ")
}

/**
 * Watch a running command: once `cancelled()` turns true, call `stop` once.
 * `fired()` tells the caller the command ended because of it; `done()` ends
 * the watch and must be called when the command returns.
 */
export function watchCancel(a: { cancelled: () => boolean; stop: () => Promise<unknown>; intervalMs?: number }): { fired: () => boolean; done: () => void } {
  let fired = false
  const timer = setInterval(() => {
    if (fired || !a.cancelled()) return
    fired = true
    clearInterval(timer)
    void a.stop().catch(() => {})
  }, a.intervalMs ?? CANCEL_POLL_MS)
  return { fired: () => fired, done: () => clearInterval(timer) }
}
