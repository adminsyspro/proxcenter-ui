/**
 * Display helpers for a node's system time (Inventory > Host > Time).
 *
 * Proxmox `GET /nodes/{node}/time` returns three fields:
 *   - `time`      the real UTC epoch (seconds)
 *   - `localtime` the SAME instant already shifted by the node's UTC offset
 *   - `timezone`  the node's IANA zone, e.g. "Europe/Berlin"
 *
 * `localtime` is a trap: it is a pre-shifted epoch. Rendering it with
 * `new Date(localtime * 1000).toLocaleString()` makes the browser apply its own
 * offset a SECOND time, double-counting it (issue #567: a Europe/Berlin host in
 * summer showed UTC+4 instead of UTC+2). The correct wall clock is obtained by
 * formatting the real UTC `time` in the node's own timezone, which is also
 * independent of the viewer's browser timezone.
 */

/**
 * Format a node's wall-clock local time from the UTC epoch and the node's zone.
 *
 * @param timeEpochSec UTC epoch in seconds (Proxmox `time` field).
 * @param timezone     Node IANA timezone (Proxmox `timezone` field).
 * @param locale       Optional locale override; defaults to the runtime locale.
 * @returns The localized wall clock, or `-` when the timestamp is missing.
 */
export function formatNodeLocalTime(
  timeEpochSec: number | null | undefined,
  timezone: string | null | undefined,
  locale?: string,
): string {
  if (!timeEpochSec) return '-'

  const date = new Date(timeEpochSec * 1000)

  if (timezone) {
    try {
      return date.toLocaleString(locale, { timeZone: timezone })
    } catch {
      // Unknown/invalid IANA zone: fall through to the viewer's local time
      // rather than throwing inside a render.
    }
  }

  return date.toLocaleString(locale)
}
