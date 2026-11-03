// Which policy flow a rule of a zone group (pcz-<zone>) is compiled from, so the Firewalling table edits the flow in
// place. The engine (proxcenter-backend internal/microseg/compile.go, Compile) writes into the group of each active
// zone Z:
//  - unless Z isolates its members: `in ACCEPT source +pcz-Z`, no service, comment "[pc-microseg] Z -> Z";
//  - for each flow whose destination zone is Z: `in ACCEPT`, source `+pcz-<source zone>` (a zone source) or the
//    flow's source CIDR, `dport` the flow's port, `proto` the flow's protocol unless it is "any", comment
//    "[pc-microseg] <source zone or CIDR> -> Z".
// So a rule is the flow with: destination zone Z, the same source (zone by its group name, or CIDR), the same
// protocol ("" in the rule = "any"), the same port. A rule matching no flow of the draft is a drift (the draft
// changed since the last apply, or Proxmox was edited by hand).

import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'
import type { RuleFields } from '@/lib/firewall/publishOps'
import { pveText } from '@/lib/firewall/publishOps'

import { ZONE_GROUP_PREFIX } from './shared/groupMembership'

export type ZoneRuleMatch =
  | { kind: 'flow'; flow: MicrosegFlow; zone: MicrosegZone }
  /** The zone's members talking to each other (its "isolate members" setting off): no flow of its own. */
  | { kind: 'intra'; zone: MicrosegZone }
  | null

const proto = (p: string | undefined) => (pveText(p) || 'any').toLowerCase()

export function matchZoneRule(rule: Pick<RuleFields, 'type' | 'action' | 'source' | 'proto' | 'dport'>, zoneName: string, zones: MicrosegZone[], flows: MicrosegFlow[]): ZoneRuleMatch {
  const zone = zones.find(z => z.name === zoneName)
  if (!zone || rule.type !== 'in' || rule.action !== 'ACCEPT') return null
  const source = pveText(rule.source)
  const srcZone = source.startsWith(`+${ZONE_GROUP_PREFIX}`) ? zones.find(z => `+${ZONE_GROUP_PREFIX}${z.name}` === source) : undefined
  const sameSource = (f: MicrosegFlow) => (srcZone ? f.src_zone_id === srcZone.id : !f.src_zone_id && pveText(f.src_cidr) === source)
  const flow = flows.find(f => f.dst_zone_id === zone.id && sameSource(f) && proto(f.proto) === proto(rule.proto) && pveText(f.dport) === pveText(rule.dport))
  if (flow) return { kind: 'flow', flow, zone }
  if (srcZone?.id === zone.id && !pveText(rule.proto) && !pveText(rule.dport) && !zone.isolate_members) return { kind: 'intra', zone }
  return null
}
