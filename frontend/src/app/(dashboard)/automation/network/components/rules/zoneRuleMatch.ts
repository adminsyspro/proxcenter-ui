// Which policy flow a rule of a zone group (pcz-<zone>) is compiled from, so the Firewalling table edits the flow in
// place. The engine (proxcenter-backend internal/microseg/compile.go, Compile) writes into the group of each active
// zone Z:
//  - unless Z isolates its members: `in ACCEPT source +pcz-Z`, no service, comment "[pc-microseg] Z -> Z";
//  - for each flow whose destination zone is Z: `in ACCEPT`, source `+pcz-<source zone>` (a zone source) or the
//    flow's source CIDR, `dport` the flow's port as written (a range "8000:8010", a list "80,443"), `proto` the
//    flow's protocol unless it is "any", comment "[pc-microseg] <source zone or CIDR> -> Z"; identical flows give
//    identical rules, in the order of the flows.
// The rules on Proxmox come from the last APPLIED revision, so a rule is matched against that revision first, then
// resolved in the draft by flow id: the flow as the draft holds it now (maybe changed, applied at the next apply), or
// gone from the draft (its removal applies at the next apply). Without a revision (or no match in it) the draft is
// matched directly; a rule matching neither is a drift: Proxmox changed by hand, or the engine has not re-applied.

import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'
import type { RuleFields } from '@/lib/firewall/publishOps'
import { pveText } from '@/lib/firewall/publishOps'

import { ZONE_GROUP_PREFIX } from './shared/groupMembership'

export type PolicyView = { zones: MicrosegZone[]; flows: MicrosegFlow[] }

export type ZoneRuleMatch =
  /** The flow as the draft holds it; `changed` when it differs from the applied one (applies at the next apply). */
  | { kind: 'flow'; flow: MicrosegFlow; zone: MicrosegZone; changed: boolean }
  /** The applied flow is no longer in the draft: its removal applies at the next apply. */
  | { kind: 'removed'; flow: MicrosegFlow }
  /** The zone's members talking to each other (its "isolate members" setting off): no flow of its own. */
  | { kind: 'intra'; zone: MicrosegZone }
  | null

type RuleKey = Pick<RuleFields, 'type' | 'action' | 'source' | 'proto' | 'dport'>

const proto = (p: string | undefined) => (pveText(p) || 'any').toLowerCase()

const FLOW_FIELDS = ['src_zone_id', 'src_cidr', 'dst_zone_id', 'proto', 'dport'] as const

const sameFlow = (a: MicrosegFlow, b: MicrosegFlow) => FLOW_FIELDS.every(k => pveText(a[k]) === pveText(b[k]))

/** The flows of `view` a rule of zone `zone` is compiled from, in order (identical flows give identical rules). */
function flowsOf(rule: RuleKey, zone: MicrosegZone, view: PolicyView): MicrosegFlow[] {
  const source = pveText(rule.source)
  const srcZone = source.startsWith(`+${ZONE_GROUP_PREFIX}`) ? view.zones.find(z => `+${ZONE_GROUP_PREFIX}${z.name}` === source) : undefined
  if (source.startsWith(`+${ZONE_GROUP_PREFIX}`) && !srcZone) return []
  const sameSource = (f: MicrosegFlow) => (srcZone ? f.src_zone_id === srcZone.id : !f.src_zone_id && pveText(f.src_cidr) === source)
  return view.flows.filter(f => f.dst_zone_id === zone.id && sameSource(f) && proto(f.proto) === proto(rule.proto) && pveText(f.dport) === pveText(rule.dport))
}

const isIntra = (rule: RuleKey, zone: MicrosegZone) =>
  pveText(rule.source) === `+${ZONE_GROUP_PREFIX}${zone.name}` && !pveText(rule.proto) && !pveText(rule.dport) && !zone.isolate_members

/** The zone of a section (named after its group as applied) as the draft holds it now: by id, so a rename keeps it. */
export function draftZoneOf(zoneName: string, draft: PolicyView, deployed: PolicyView | null): MicrosegZone | undefined {
  const applied = deployed?.zones.find(z => z.name === zoneName)
  return (applied && draft.zones.find(z => z.id === applied.id)) ?? draft.zones.find(z => z.name === zoneName)
}

/**
 * The flow a rule of the group of zone `zoneName` comes from. `occurrence` is the rank of the rule among the identical
 * rules of the group above it (0 for the first): identical flows map one to one, in order.
 */
export function matchZoneRule(rule: RuleKey, zoneName: string, draft: PolicyView, deployed: PolicyView | null, occurrence = 0): ZoneRuleMatch {
  if (rule.type !== 'in' || rule.action !== 'ACCEPT') return null
  const appliedZone = deployed?.zones.find(z => z.name === zoneName)
  if (deployed && appliedZone) {
    const applied = flowsOf(rule, appliedZone, deployed)[occurrence]
    if (applied) {
      const now = draft.flows.find(f => f.id === applied.id)
      if (!now) return { kind: 'removed', flow: applied }
      return { kind: 'flow', flow: now, zone: draft.zones.find(z => z.id === appliedZone.id) ?? appliedZone, changed: !sameFlow(applied, now) }
    }
    if (isIntra(rule, appliedZone)) return { kind: 'intra', zone: draft.zones.find(z => z.id === appliedZone.id) ?? appliedZone }
  }
  const zone = draftZoneOf(zoneName, draft, deployed)
  if (!zone) return null
  const flow = flowsOf(rule, zone, draft)[occurrence]
  if (flow) return { kind: 'flow', flow, zone, changed: false }
  return isIntra(rule, zone) ? { kind: 'intra', zone } : null
}

/** The rank of each rule among the identical rules (same source, protocol, port) above it in its group. */
export function occurrences(rules: RuleKey[]): number[] {
  const seen = new Map<string, number>()
  return rules.map(r => {
    const key = `${pveText(r.source)}|${proto(r.proto)}|${pveText(r.dport)}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return n
  })
}
