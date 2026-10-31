import type { AvailabilityState, Slot } from '@/lib/availability/types'

import { slotEnd } from './availabilityFormat'

/** One bar of a status page row: a run of whole slots, shown in its worst state. */
export interface StatusBar {
  start: string
  end: string
  state: AvailabilityState
  /** Index of the first slot of the bar in the row. */
  first: number
  /** Slots the bar holds. */
  count: number
  /** Index of the first slot of each outage the bar holds: where a down run begins, or the bar's first slot. */
  downStarts: number[]
  /** %, up over up + down within the bar, null when neither was seen. */
  availability: number | null
}

/** The most bars a row shows when its width is not known, as on a status page. */
export const MAX_BARS = 90

/** Width given to one bar and its gap: a row shows as many bars as fit, ~10 px each, 30 at least. */
export const BAR_PITCH_PX = 10
const MIN_BARS = 30

/** The most bars a row of `width` px holds, MAX_BARS while the width is unknown. */
export function maxBarsFor(width: number): number {
  return width > 0 ? Math.max(MIN_BARS, Math.floor(width / BAR_PITCH_PX)) : MAX_BARS
}

// The lengths a bar may have, shortest first, each a round span of the clock:
// a row takes the shortest that fits its width.
const DAY = 24 * 3600
const BAR_SECONDS = [60, 120, 300, 600, 900, 1200, 1800, 3600, 2 * 3600, 3 * 3600, 4 * 3600, 6 * 3600, 8 * 3600, 12 * 3600, DAY, 2 * DAY, 3 * DAY, 4 * DAY, 7 * DAY, 14 * DAY]

// A bar takes the state that matters most of its slots: an outage of a minute
// still reds its day, as on a status page.
const PRIORITY: readonly AvailabilityState[] = ['down', 'maintenance', 'up', 'unobserved', 'absent']

/** The slots of a row grouped into at most `maxBars` bars of the shortest length that fits. */
export function statusBars(slots: readonly Slot[], to?: string, maxBars = MAX_BARS): StatusBar[] {
  if (slots.length === 0) return []

  const slotSeconds = slots.length > 1 ? (Date.parse(slots[1].start) - Date.parse(slots[0].start)) / 1000 : 60
  const total = slots.length * slotSeconds
  // A bar is whole slots: a length shorter than a slot, or not a multiple of it, is skipped.
  const barSeconds = BAR_SECONDS.find(b => b >= slotSeconds && b % slotSeconds === 0 && total / b <= maxBars) ?? BAR_SECONDS[BAR_SECONDS.length - 1]
  const size = Math.max(1, Math.round(barSeconds / slotSeconds))
  const bars: StatusBar[] = []

  for (let first = 0; first < slots.length; first += size) {
    const group = slots.slice(first, first + size)
    const seen = new Set(group.map(s => s.state))
    const up = group.filter(s => s.state === 'up').length
    const down = group.filter(s => s.state === 'down').length
    const downStarts = group.flatMap((s, i) =>
      s.state === 'down' && (i === 0 || group[i - 1].state !== 'down') ? [first + i] : [])

    bars.push({
      start: group[0].start,
      end: slotEnd(slots, group[group.length - 1], to),
      state: PRIORITY.find(s => seen.has(s)) ?? 'absent',
      first,
      count: group.length,
      downStarts,
      availability: up + down === 0 ? null : (up / (up + down)) * 100,
    })
  }

  return bars
}
