import type { MicrosegDrift } from '@/lib/microseg/types'

import { guestKey } from './zoneModel'

/** The kinds the engine reports (drift.go), in the order the sub-tab documents them. */
export const DRIFT_KINDS = [
  'unzoned_running', 'nic_firewall_off', 'foreign_accept', 'ipset_out_of_sync', 'member_without_ip', 'ambiguous_zone', 'object_collision',
] as const

/**
 * What the Fix button does: "assign" opens the assign dialog for a chosen zone (the only drift fixed by a
 * draft change), "plan" opens the plan window, where the engine's findings (collisions, rules kept, guests
 * in several zones) and the steps that realign Proxmox are shown.
 */
export type DriftFix = 'assign' | 'plan'

export type DriftLabel = { title: string; detail: string; fixable: boolean; fix: DriftFix | null }

/** `t` is the translator of the `microsegPilot.drifts.kind` namespace. */
type Translate = (key: string, values?: Record<string, string | number>) => string

const FIX_OF: Record<(typeof DRIFT_KINDS)[number], DriftFix> = {
  unzoned_running: 'assign',
  ambiguous_zone: 'assign',
  nic_firewall_off: 'plan',
  foreign_accept: 'plan',
  ipset_out_of_sync: 'plan',
  member_without_ip: 'plan',
  object_collision: 'plan',
}

const isKnown = (kind: string): kind is (typeof DRIFT_KINDS)[number] => (DRIFT_KINDS as readonly string[]).includes(kind)

const text = (value: unknown, fallback = '-'): string => (typeof value === 'string' && value ? value : fallback)

const list = (value: unknown): string => {
  const items = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  return items.length ? items.join(', ') : '-'
}

/** The values the translated detail of a drift reads from its `detail` object. */
function valuesOf(d: MicrosegDrift): Record<string, string | number> {
  const detail = d.detail ?? {}
  return {
    name: text(detail.name, d.guest ? `${d.guest.type}/${d.guest.vmid}` : '-'),
    nics: list(detail.nics),
    pos: typeof detail.pos === 'number' ? detail.pos : '-',
    object: text(d.object),
    desired: list(detail.desired),
    actual: list(detail.actual),
    zone: text(detail.zone),
    kind: d.kind,
  }
}

/** Title, one-line detail and fix of a drift; an unknown kind gets a generic label and no fix. */
export function driftLabel(d: MicrosegDrift, t: Translate): DriftLabel {
  const values = valuesOf(d)
  if (!isKnown(d.kind)) return { title: t('generic.title', values), detail: t('generic.detail', values), fixable: false, fix: null }
  // A foreign rule inside one of our groups has no guest: its detail names the group.
  const detailKey = d.kind === 'foreign_accept' && !d.guest ? 'foreign_accept.detailGroup' : `${d.kind}.detail`
  const fix = FIX_OF[d.kind]
  return { title: t(`${d.kind}.title`, values), detail: t(detailKey, values), fixable: true, fix }
}

/** Identity of a drift for "Ignore": the kind, the guest (type and vmid, like the backend), the object and the rule position. */
export function driftKey(d: MicrosegDrift): string {
  const pos = typeof d.detail?.pos === 'number' ? String(d.detail.pos) : ''
  return [d.kind, d.guest ? guestKey(d.guest) : '', d.object ?? '', pos].join('|')
}
