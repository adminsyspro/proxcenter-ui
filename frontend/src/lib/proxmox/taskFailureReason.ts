// Why a PVE task failed, read from its log (#926).
//
// The task status only carries `exitstatus`, which for a migration is the
// useless "migration aborted". PVE writes the real cause into the log, as an
// "ERROR: ..." line and, for most task types, a final "TASK ERROR: ...". This
// picks the most specific of those lines so the UI can show it on the failed
// row instead of sending the operator to the Proxmox web interface.

/** Longest reason returned; the full text stays in the task log. */
export const TASK_FAILURE_REASON_MAX = 300

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\s+/
const TASK_ERROR = /^TASK ERROR:\s*(.+)$/
const ERROR_PREFIX = /(?:^|\s)ERROR:\s*(.+)$/
const LOOSE_ERROR = /\b(?:error|failed|failure)\b/i
// "migration aborted (duration 00:00:02): <reason>" carries the reason after the colon.
const ABORTED_WITH_DURATION = /^migration aborted \(duration [^)]*\):\s*/i

// Messages that only say "it failed" and never why.
const GENERIC = [
  /^migration aborted$/i,
  /^migration problems$/i,
  /^migration finished with problems/i,
  /^unknown error$/i,
  /^job errors$/i,
]

// Lines that contain "error" or "failed" without being one.
const NOISE = [
  /^TASK (?:OK|WARNINGS)/,
  /^aborting phase \d/i,
  /\b0 errors?\b/i,
  /\d+(?:\.\d+)?\s*%/,
  /\btransferred\b/i,
  /^WARN(?:ING)?:/i,
]

function clean(text: string): string {
  return text.replace(TIMESTAMP, '').replace(ABORTED_WITH_DURATION, '').trim()
}

function cap(text: string): string {
  return text.length > TASK_FAILURE_REASON_MAX ? `${text.slice(0, TASK_FAILURE_REASON_MAX - 1)}…` : text
}

const isGeneric = (text: string) => GENERIC.some(re => re.test(text))

/**
 * The most useful failure reason in a PVE task log, or null when the log has
 * none. Prefers, from the end of the log: a specific "ERROR:"/"TASK ERROR:"
 * message, then any other line that mentions an error, then a generic
 * "TASK ERROR:" message.
 */
export function extractTaskFailureReason(logs: ReadonlyArray<{ t?: string } | null | undefined>): string | null {
  let loose: string | null = null
  let generic: string | null = null

  for (let i = logs.length - 1; i >= 0; i--) {
    const line = clean(logs[i]?.t || '')
    if (!line) continue

    const tagged = TASK_ERROR.exec(line) || ERROR_PREFIX.exec(line)
    if (tagged) {
      const message = clean(tagged[1])
      if (message && !isGeneric(message)) return cap(message)
      generic ??= message || null
      continue
    }

    if (!loose && LOOSE_ERROR.test(line) && !NOISE.some(re => re.test(line))) loose = line
  }

  const reason = loose ?? generic

  return reason ? cap(reason) : null
}
