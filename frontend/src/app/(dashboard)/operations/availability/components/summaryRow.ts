import type { AvailabilityState, Incident, Result, Slot } from '@/lib/availability/types'

import type { ConnectionOverview } from '../hooks/useAvailabilityOverview'

/** Which state a slot of the summary keeps when its rows disagree: the worst one. */
const RANK: Record<AvailabilityState, number> = { absent: 0, up: 1, unobserved: 2, maintenance: 3, down: 4 }

/** The slots of the rows merged slot by slot, each holding the worst state any row had then. */
export function mergeSlots(rows: Result[]): Slot[] {
  const worst = new Map<string, AvailabilityState>()

  for (const row of rows) {
    for (const s of row.slots) {
      const held = worst.get(s.start)

      if (held === undefined || RANK[s.state] > RANK[held]) worst.set(s.start, s.state)
    }
  }

  return [...worst].map(([start, state]) => ({ start, state })).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

/** The runs of down slots, each ending where the next slot begins or at `to`. */
function downRuns(slots: Slot[], to: string): Incident[] {
  const runs: Incident[] = []

  slots.forEach((s, i) => {
    if (s.state !== 'down') return

    const end = slots[i + 1]?.start ?? to

    if (i > 0 && slots[i - 1].state === 'down') runs[runs.length - 1].to = end
    else runs.push({ from: s.start, to: end, state: 'down' })
  })

  return runs
}

/**
 * One row for a whole connection: its cluster and nodes merged, a slot down
 * as soon as one of them was. The rates are the connection's own.
 */
export function summaryResult(connection: ConnectionOverview, to: string): Result {
  const slots = mergeSlots([...(connection.cluster ? [connection.cluster] : []), ...connection.nodes])
  const { summary } = connection

  return {
    ref: { connection_id: connection.id, kind: 'cluster' },
    up_seconds: summary.up_seconds,
    down_seconds: summary.down_seconds,
    maintenance_seconds: 0,
    unobserved_seconds: summary.unobserved_seconds,
    availability: summary.availability,
    coverage: summary.coverage,
    slots,
    incidents: downRuns(slots, to),
  }
}
