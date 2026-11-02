import type { useFormatter } from 'next-intl'

import type { MicrosegSnapshot, MicrosegStatus } from '@/lib/microseg/types'

/** A pause whose end is past is over (the engine clears the field on its next pass). */
export function stillPaused(pausedUntil: string | null | undefined): boolean {
  return !!pausedUntil && !(Date.parse(pausedUntil) <= Date.now())
}

/** A date for a line of text: medium date and short time, or the raw text when it is not a date. */
export function formatWhen(format: ReturnType<typeof useFormatter>, iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })
}

/** What an admin starts, not what the engine does by itself: these runs are not "checks". */
const ADMIN_KINDS = new Set(['plan', 'apply', 'remove', 'restore'])

/** Zones of the last applied revision that enforce, and those that only observe (disabled ones are neither). */
export function deployedCounts(snapshot: MicrosegSnapshot): { enforced: number; observing: number } {
  const zones = snapshot.zones ?? []
  return {
    enforced: zones.filter(z => z.state === 'enforce').length,
    observing: zones.filter(z => z.state === 'observe').length,
  }
}

/** When the engine last looked at the cluster: its newest own run, whatever the kind. Null before the first one. */
export function lastCheckAt(status: Pick<MicrosegStatus, 'engine'>): Date | null {
  let newest: Date | null = null
  for (const [kind, run] of Object.entries(status.engine.last_runs ?? {})) {
    if (ADMIN_KINDS.has(kind)) continue
    const at = new Date(run.started_at)
    if (Number.isNaN(at.getTime())) continue
    if (!newest || at > newest) newest = at
  }
  return newest
}
