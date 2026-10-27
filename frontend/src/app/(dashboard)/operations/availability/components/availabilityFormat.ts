'use client'

import { useFormatter } from 'next-intl'

import type { Slot } from '@/lib/availability/types'
import { formatUptime } from '@/utils/format'

/** Where a slot ends: the start of the next one, or one slot length after the last start, never past `to`. */
export function slotEnd(slots: readonly Slot[], slot: Slot, to?: string): string {
  const i = slots.indexOf(slot)
  const next = slots[i + 1]

  if (next) return next.start

  const length = slots.length > 1 ? Date.parse(slots[1].start) - Date.parse(slots[0].start) : 60000

  const end = Date.parse(slot.start) + length

  return new Date(to ? Math.min(end, Date.parse(to)) : end).toISOString()
}

/**
 * The period a row stayed in the state of a slot: the slot and every
 * neighbour in the same state. One slot of a 24 h row is a minute, so the run
 * is what tells when an outage started and ended.
 */
export function stateRun(slots: readonly Slot[], slot: Slot, to?: string): { state: Slot['state']; start: string; end: string } {
  let first = slots.indexOf(slot)
  if (first < 0) return { state: slot.state, start: slot.start, end: slotEnd([slot], slot, to) }
  let last = first

  while (first > 0 && slots[first - 1].state === slot.state) first--
  while (last < slots.length - 1 && slots[last + 1].state === slot.state) last++

  return { state: slot.state, start: slots[first].start, end: slotEnd(slots, slots[last], to) }
}

/** A length in seconds: seconds under a minute (a 99.999% budget is seconds), formatUptime above. */
export function span(seconds: number): string {
  return seconds < 60 ? `${Math.max(0, Math.round(seconds))}s` : formatUptime(seconds)
}

/** Locale-aware rate, date and duration formatting of the availability page. */
export function useAvailabilityFormat() {
  const format = useFormatter()

  return {
    /**
     * A percentage cut (not rounded) to two decimals: 99.999 must not read as
     * 100%. The epsilon absorbs the float error of value * 100 (0.29 * 100 is
     * 28.999999999999996).
     */
    rate: (value: number) =>
      format.number(Math.floor(value * 100 + 1e-9) / 10000, { style: 'percent', maximumFractionDigits: 2 }),
    /** A policy target as entered: up to the 3 decimals a target may carry. */
    target: (value: number) => format.number(value / 100, { style: 'percent', maximumFractionDigits: 3 }),
    dateTime: (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'medium' }),
    duration: (fromIso: string, toIso: string) => span((Date.parse(toIso) - Date.parse(fromIso)) / 1000),
    span,
  }
}
