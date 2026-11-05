import { serviceLabel } from '@/lib/network/serviceNames'
import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'

import { guestKey } from './zoneModel'

/** The group of the known destinations (the orchestrator's KnownGroup): a misplaced rule on it is the known rule. */
const KNOWN_GROUP = 'pcz-_known'

/** The kinds the engine reports (drift.go), in the order the sub-tab documents them. */
export const DRIFT_KINDS = [
  'unzoned_running', 'nic_firewall_off', 'foreign_accept', 'ipset_out_of_sync', 'member_without_ip', 'ambiguous_zone', 'object_collision',
  'egress_rule_missing', 'egress_rule_misplaced', 'egress_rule_verdict', 'known_rule_missing', 'known_rule_extra', 'local_set_desync', 'egress_no_subnet',
] as const

/**
 * What the Fix button does: "assign" opens the assign dialog for a chosen zone (a draft change), "plan" opens
 * the plan window, whose steps realign Proxmox. The drifts neither of them repairs (a rule or an object that
 * is not ours, a member without an IP) have no fix: they carry a hint on what to do in Proxmox instead.
 */
export type DriftFix = 'assign' | 'plan'

export type DriftLabel = { title: string; detail: string; fixable: boolean; fix: DriftFix | null; hint: string | null }

/** `t` is the translator of the `microsegPilot.drifts.kind` namespace. */
type Translate = (key: string, values?: Record<string, string | number>) => string

const FIX_OF: Record<(typeof DRIFT_KINDS)[number], DriftFix | null> = {
  unzoned_running: 'assign',
  ambiguous_zone: 'assign',
  nic_firewall_off: 'plan',
  foreign_accept: null,
  ipset_out_of_sync: 'plan',
  member_without_ip: null,
  object_collision: null,
  egress_rule_missing: 'plan',
  egress_rule_misplaced: 'plan',
  egress_rule_verdict: 'plan',
  known_rule_missing: 'plan',
  known_rule_extra: 'plan',
  local_set_desync: 'plan',
  egress_no_subnet: null,
}

const isKnown = (kind: string): kind is (typeof DRIFT_KINDS)[number] => (DRIFT_KINDS as readonly string[]).includes(kind)

const text = (value: unknown, fallback = '-'): string => (typeof value === 'string' && value ? value : fallback)

const list = (value: unknown): string => {
  const items = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  return items.length ? items.join(', ') : '-'
}

/** The rule a foreign accept is about, as the engine read it: "<source> <proto>/<dport>", whatever of it is known. */
function ruleOf(detail: Record<string, unknown>): string {
  const source = text(detail.source, '')
  const proto = text(detail.proto, '')
  const dport = text(detail.dport, '')
  const service = proto ? serviceLabel(proto, dport) : dport
  return [source, service].filter(Boolean).join(' ') || '-'
}

/** The values the translated detail of a drift reads from its `detail` object. */
function valuesOf(d: MicrosegDrift, t: Translate): Record<string, string | number> {
  // PVE names (ACCEPT, DROP) stay as they are; a disabled rule is said in the user's language.
  const verdict = (v: unknown) => (v === 'DISABLED' ? t('verdict.disabled') : text(v))
  const detail = d.detail ?? {}
  return {
    name: text(detail.name, d.guest ? `${d.guest.type}/${d.guest.vmid}` : '-'),
    nics: list(detail.nics),
    rule: ruleOf(detail),
    pos: typeof detail.pos === 'number' ? detail.pos : '-',
    object: text(d.object),
    desired: list(detail.desired),
    actual: list(detail.actual),
    zone: text(detail.zone),
    want: verdict(detail.want),
    have: verdict(detail.have),
    kind: d.kind,
  }
}

type DetailVariant = 'group' | 'collision' | 'known' | null

/** Which wording of the detail a drift takes: a foreign rule in a group, a zone that cannot block, a misplaced known rule. */
function detailVariant(d: MicrosegDrift): DetailVariant {
  if (d.kind === 'foreign_accept' && !d.guest) return 'group'
  if ((d.kind === 'egress_rule_missing' || d.kind === 'egress_rule_verdict') && d.detail?.reason === 'collision') return 'collision'
  if (d.kind === 'egress_rule_misplaced' && d.object === KNOWN_GROUP) return 'known'
  return null
}

function hintKeyOf(d: MicrosegDrift, collided: boolean): string {
  if (d.kind === 'foreign_accept') return d.guest ? 'foreign_accept.hint' : 'foreign_accept.hintGroup'
  return collided ? `${d.kind}.hintCollision` : `${d.kind}.hint`
}

/** Title, one-line detail and fix of a drift; an unknown kind gets a generic label and no fix. */
export function driftLabel(d: MicrosegDrift, t: Translate): DriftLabel {
  const values = valuesOf(d, t)
  if (!isKnown(d.kind)) return { title: t('generic.title', values), detail: t('generic.detail', values), fixable: false, fix: null, hint: null }
  // A foreign rule inside one of our groups has no guest: its detail names the group.
  const variant = detailVariant(d)
  const detailKey = variant ? `${d.kind}.${variant === 'group' ? 'detailGroup' : variant === 'collision' ? 'detailCollision' : 'detailKnown'}` : `${d.kind}.detail`
  // A verdict the zone cannot reach because pcz-_local is not ours is no plan's job: Proxmox holds the fix.
  const collided = variant === 'collision'
  const fix = collided ? null : FIX_OF[d.kind]
  const hintKey = hintKeyOf(d, collided)
  return { title: t(`${d.kind}.title`, values), detail: t(detailKey, values), fixable: fix !== null, fix, hint: fix === null ? t(hintKey, values) : null }
}

/** Identity of a drift for "Ignore": the kind, the guest (type and vmid, like the backend), the object and the rule position. */
export function driftKey(d: MicrosegDrift): string {
  const pos = typeof d.detail?.pos === 'number' ? String(d.detail.pos) : ''
  return [d.kind, d.guest ? guestKey(d.guest) : '', d.object ?? '', pos].join('|')
}

/** The zone a drift is about (its detail names it by name or id), when the policy holds it. */
export function zoneOfDrift(d: MicrosegDrift, zones: MicrosegZone[]): MicrosegZone | null {
  const ref = d.detail?.zone
  if (typeof ref !== 'string' || !ref) return null
  return zones.find(z => z.id === ref || z.name === ref) ?? null
}
