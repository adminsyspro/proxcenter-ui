/**
 * Parse the free-form `text` blob PVE returns from
 * /nodes/{node}/disks/smart?disk= for NVMe drives.
 *
 * Measured on real Micron 7450 NVMe drives: PVE returns `type: "text"` with
 * no `attributes` array at all, so this is the common shape on real
 * hardware, not a fallback for virtualized disks. smartctl aligns labels and
 * values with runs of spaces, for example:
 *
 *   SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)
 *   Critical Warning:                   0x00
 *   Available Spare:                    100%
 *
 * The first line is a section header, not a `Label: value` row. Every
 * subsequent non-blank line is either a `Label: value` row or, if it does
 * not match that shape, kept verbatim in `leftover` so nothing is silently
 * dropped.
 */

/**
 * Two SMART percentages can mean opposite things: `Available Spare` is
 * REMAINING capacity (high is healthy), `Percentage Used` is CONSUMED life
 * (high is unhealthy). Classify explicitly by label rather than guessing,
 * and default to 'unknown' for anything not in the list below.
 */
export type SmartTextDirection = 'higher-is-better' | 'higher-is-worse' | 'unknown'

export type SmartTextRow = {
  label: string
  value: string
  /** Set only when `value` is itself a percentage figure, e.g. "100%" -> 100. */
  percent: number | null
  direction: SmartTextDirection
  /**
   * True for a row that qualifies another row rather than gauging health on
   * its own, e.g. "Available Spare Threshold". Even when it carries a
   * percent, it must never be drawn as a progress bar.
   */
  isReference: boolean
}

export type SmartTextView = {
  header: string | null
  rows: SmartTextRow[]
  leftover: string[]
}

/** Explicit direction classification. Do not guess at labels not listed here. */
const DIRECTION_BY_LABEL: Record<string, SmartTextDirection> = {
  'Available Spare': 'higher-is-better',
  'Percentage Used': 'higher-is-worse',
}

/** Reference values that qualify another row and must never get a bar. */
const REFERENCE_LABELS = new Set<string>(['Available Spare Threshold'])

const ROW_PATTERN = /^([^:]+):[ \t]+(.+)$/
const PERCENT_PATTERN = /^(\d+(?:\.\d+)?)%$/

function parseRow(line: string): { label: string; value: string } | null {
  const match = ROW_PATTERN.exec(line)
  if (!match) return null

  const label = match[1].trim()
  const value = match[2].trim().replace(/\s+/g, ' ')

  if (!label || !value) return null

  return { label, value }
}

function extractPercent(value: string): number | null {
  const match = PERCENT_PATTERN.exec(value)
  return match ? Number(match[1]) : null
}

export function parseSmartText(text: string): SmartTextView {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  if (normalized.trim() === '') return { header: null, rows: [], leftover: [] }

  const lines = normalized.split('\n')
  const rows: SmartTextRow[] = []
  const leftover: string[] = []
  let header: string | null = null

  lines.forEach((rawLine, index) => {
    if (index === 0) {
      const trimmed = rawLine.trim()
      header = trimmed === '' ? null : trimmed
      return
    }

    if (rawLine.trim() === '') return

    const parsed = parseRow(rawLine)

    if (!parsed) {
      leftover.push(rawLine.trim())
      return
    }

    const percent = extractPercent(parsed.value)
    const direction = DIRECTION_BY_LABEL[parsed.label] ?? 'unknown'
    const isReference = REFERENCE_LABELS.has(parsed.label)

    rows.push({ label: parsed.label, value: parsed.value, percent, direction, isReference })
  })

  return { header, rows, leftover }
}
