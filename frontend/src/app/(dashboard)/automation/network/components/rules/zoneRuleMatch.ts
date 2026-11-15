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
//
// A zone that controls what its members send (outbound observed or blocked) also gets, in its own group (outRules):
//  - unless it isolates its members: `out ACCEPT dest +pcz-Z`, no service, comment "[pc-microseg] Z -> Z";
//  - for each flow whose SOURCE zone is Z: `out ACCEPT`, dest `+pcz-<destination zone>` or the flow's destination
//    CIDR, same protocol and port, comment "[pc-microseg] Z -> <destination zone or CIDR>".
// These are the same flows and the same zone setting seen from the sending side: they resolve the same way.
// While a zone observes its outbound traffic, the group pcz-_known holds one `out ACCEPT dest +pcz-<zone>` per active
// zone, comment "[pc-microseg] <zone>": what goes to a known zone is not logged. It is no zone and has no flow.
//
// An exception (internal/microseg/exception.go, exceptionRules) gives, for each source guest, destination guest and
// service: `in ACCEPT source +pcz-_vm<source vmid> dest +pcz-_vm<destination vmid>` in the group of its zone, `proto`
// unless "any", `dport` as written, comment "[pc-microseg] vm<source> -> vm<destination>"; and the same rule as `out`
// in the group of the source's zone when that zone controls its outbound traffic. It is resolved as a flow is: the
// applied revision first, then the draft by exception id.

import type { GuestRefLite, MicrosegException, MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'
import type { RuleFields } from '@/lib/firewall/publishOps'
import { isEngineComment, pveText } from '@/lib/firewall/publishOps'

import { ZONE_GROUP_PREFIX } from './shared/groupMembership'

/** `exceptions` is absent on a revision taken before the exceptions existed: read as none. */
export type PolicyView = { zones: MicrosegZone[]; flows: MicrosegFlow[]; exceptions?: MicrosegException[] }

export type ZoneRuleMatch =
  /** The flow as the draft holds it; `changed` when it differs from the applied one (applies at the next apply). */
  | { kind: 'flow'; flow: MicrosegFlow; zone: MicrosegZone; changed: boolean }
  /** The applied flow is no longer in the draft: its removal applies at the next apply. */
  | { kind: 'removed'; flow: MicrosegFlow }
  /** The zone's members talking to each other (its "isolate members" setting off): no flow of its own. */
  | { kind: 'intra'; zone: MicrosegZone }
  /** A rule of the group of the known zones (pcz-_known): traffic to this zone is not logged by an observed zone. */
  | { kind: 'known'; zone: MicrosegZone }
  /**
   * A rule of an exception, between the two guests as the exception names them. `removed`: the rule leaves at the next
   * apply (the exception is gone from the draft, or no longer names these guests or this service).
   */
  | { kind: 'exception'; exception: MicrosegException; source: GuestRefLite; destination: GuestRefLite; removed: boolean }
  | null

type RuleKey = Pick<RuleFields, 'type' | 'action' | 'source' | 'proto' | 'dport'> & Partial<Pick<RuleFields, 'dest' | 'comment'>>

const proto = (p: string | undefined) => (pveText(p) || 'any').toLowerCase()

const FLOW_FIELDS = ['src_zone_id', 'src_cidr', 'dst_zone_id', 'proto', 'dport'] as const

const sameFlow = (a: MicrosegFlow, b: MicrosegFlow) => FLOW_FIELDS.every(k => pveText(a[k]) === pveText(b[k]))

/** The name of the group of the known zones after the prefix (Go KnownGroup "pcz-_known"). */
const KNOWN_GROUP_ZONE = '_known'

const groupRef = (zone: MicrosegZone) => `+${ZONE_GROUP_PREFIX}${zone.name}`

/** The side of a rule that names the other end of its flow: the source of an inbound rule, the destination of an outbound one. */
const peerOf = (rule: RuleKey) => pveText(rule.type === 'out' ? rule.dest : rule.source)

/** An engine rule of a group names one end only: an outbound rule has no source. */
const oneEnded = (rule: RuleKey) => rule.type !== 'out' || !pveText(rule.source)

/**
 * The flows of `view` a rule of zone `zone` is compiled from, in order (identical flows give identical rules): the
 * flows into the zone for an inbound rule, the flows leaving it for an outbound one.
 */
function flowsOf(rule: RuleKey, zone: MicrosegZone, view: PolicyView): MicrosegFlow[] {
  const out = rule.type === 'out'
  const peer = peerOf(rule)
  const peerZone = peer.startsWith(`+${ZONE_GROUP_PREFIX}`) ? view.zones.find(z => groupRef(z) === peer) : undefined
  if (!oneEnded(rule) || (peer.startsWith(`+${ZONE_GROUP_PREFIX}`) && !peerZone)) return []
  const own = (f: MicrosegFlow) => (out ? f.src_zone_id : f.dst_zone_id) === zone.id
  const peerZoneId = (f: MicrosegFlow) => (out ? f.dst_zone_id : f.src_zone_id)
  const peerCidr = (f: MicrosegFlow) => pveText(out ? f.dst_cidr : f.src_cidr)
  const samePeer = (f: MicrosegFlow) => (peerZone ? peerZoneId(f) === peerZone.id : !peerZoneId(f) && !!peer && peerCidr(f) === peer)
  return view.flows.filter(f => own(f) && samePeer(f) && proto(f.proto) === proto(rule.proto) && pveText(f.dport) === pveText(rule.dport))
}

const isIntra = (rule: RuleKey, zone: MicrosegZone) =>
  oneEnded(rule) && peerOf(rule) === groupRef(zone) && !pveText(rule.proto) && !pveText(rule.dport) && !zone.isolate_members

/** The zone a rule of the group of the known zones stands for: of the applied revision first, by id in the draft. */
function matchKnown(rule: RuleKey, draft: PolicyView, deployed: PolicyView | null): ZoneRuleMatch {
  if (rule.type !== 'out' || pveText(rule.source) || pveText(rule.proto) || pveText(rule.dport) || !isEngineComment(pveText(rule.comment))) return null
  const dest = pveText(rule.dest)
  const applied = deployed?.zones.find(z => groupRef(z) === dest)
  const zone = (applied && draft.zones.find(z => z.id === applied.id)) ?? applied ?? draft.zones.find(z => groupRef(z) === dest)
  return zone ? { kind: 'known', zone } : null
}

/** The ipset of one guest an exception names (Go VMSetPrefix): a zone name starts with a letter, so no zone has it. */
const VM_SET = new RegExp(String.raw`^\+${ZONE_GROUP_PREFIX}_vm(\d+)$`)

const vmOf = (ref: string | undefined) => {
  const m = VM_SET.exec(pveText(ref))
  return m ? Number(m[1]) : null
}

type ExceptionPair = { exception: MicrosegException; source: GuestRefLite; destination: GuestRefLite }

/**
 * The exception of `view` that gives `rule` between guests `src` and `dst`: one of zone `zone` for an inbound rule
 * (the group of its zone), any for an outbound one (the group of the zone of its source).
 */
function exceptionOf(rule: RuleKey, src: number, dst: number, zone: MicrosegZone | undefined, view: PolicyView): ExceptionPair | null {
  for (const exception of view.exceptions ?? []) {
    if (rule.type === 'in' && exception.zone_id !== zone?.id) continue
    const source = exception.sources.find(g => g.vmid === src)
    const destination = exception.destinations.find(g => g.vmid === dst)
    const service = exception.services.some(s => proto(s.proto) === proto(rule.proto) && pveText(s.dport) === pveText(rule.dport))
    if (source && destination && service) return { exception, source, destination }
  }
  return null
}

/** The exception a rule between two guest ipsets comes from: the applied revision first, then the draft. */
function matchException(rule: RuleKey, zoneName: string, draft: PolicyView, deployed: PolicyView | null): ZoneRuleMatch {
  const src = vmOf(rule.source)
  const dst = vmOf(rule.dest)
  if (src === null || dst === null || !isEngineComment(pveText(rule.comment))) return null
  const applied = deployed && exceptionOf(rule, src, dst, deployed.zones.find(z => z.name === zoneName), deployed)
  if (applied) {
    const now = (draft.exceptions ?? []).find(e => e.id === applied.exception.id)
    const kept = now ? exceptionOf(rule, src, dst, draft.zones.find(z => z.id === now.zone_id), { ...draft, exceptions: [now] }) : null
    return kept ? { kind: 'exception', ...kept, removed: false } : { kind: 'exception', ...applied, removed: true }
  }
  const direct = exceptionOf(rule, src, dst, draftZoneOf(zoneName, draft, deployed), draft)
  return direct ? { kind: 'exception', ...direct, removed: false } : null
}

/** The zone of a section (named after its group as applied) as the draft holds it now: by id, so a rename keeps it. */
export function draftZoneOf(zoneName: string, draft: PolicyView, deployed: PolicyView | null): MicrosegZone | undefined {
  const applied = deployed?.zones.find(z => z.name === zoneName)
  return (applied && draft.zones.find(z => z.id === applied.id)) ?? draft.zones.find(z => z.name === zoneName)
}

/**
 * The flow (into the zone for an inbound rule, leaving it for an outbound one) a rule of the group of zone `zoneName`
 * comes from. `occurrence` is the rank of the rule among the identical
 * rules of the group above it (0 for the first): identical flows map one to one, in order.
 */
export function matchZoneRule(rule: RuleKey, zoneName: string, draft: PolicyView, deployed: PolicyView | null, occurrence = 0): ZoneRuleMatch {
  if (rule.action !== 'ACCEPT' || (rule.type !== 'in' && rule.type !== 'out')) return null
  if (zoneName === KNOWN_GROUP_ZONE) return matchKnown(rule, draft, deployed)
  if (vmOf(rule.source) !== null) return matchException(rule, zoneName, draft, deployed)
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

/** The rank of each rule among the identical rules (same direction, source, destination, protocol, port) above it in its group. */
export function occurrences(rules: RuleKey[]): number[] {
  const seen = new Map<string, number>()
  return rules.map(r => {
    const key = `${r.type}|${pveText(r.source)}|${pveText(r.dest)}|${proto(r.proto)}|${pveText(r.dport)}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return n
  })
}
