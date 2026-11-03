// What the Firewalling table (UA51) shows, computed from what the page already read: the sections, the guest groups,
// the filter, the service names and the hits of the zone rules. No request here.

import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'
import type { SecurityGroup } from '@/lib/api/firewall'
import type { RuleFields } from '@/lib/firewall/publishOps'
import type { MicrosegEvent, MicrosegSnapshot, ZoneState } from '@/lib/microseg/types'
import { serviceLabel, serviceTitle } from '@/lib/network/serviceNames'

import { ZONE_GROUP_PREFIX, groupMembers } from './shared/groupMembership'

export type ScopeFilter = 'all' | 'cluster' | 'hosts' | 'vms'

export const SCOPE_FILTERS: ScopeFilter[] = ['cluster', 'hosts', 'vms', 'all']

/** The sub-tab the page hands over (0 cluster, 1 hosts, 2 VMs) as the scope the table opens on. */
export function scopeOfSubTab(subTab: number, standalone: boolean): ScopeFilter {
  if (subTab === 2) return 'vms'
  if (subTab === 1 && !standalone) return 'hosts'
  return 'all'
}

export const showsCluster = (f: ScopeFilter) => f === 'all' || f === 'cluster'
export const showsHosts = (f: ScopeFilter) => f === 'all' || f === 'hosts'
export const showsGuests = (f: ScopeFilter) => f === 'all' || f === 'vms'

/** A micro-segmentation zone group, read-only here: the engine writes it. */
export type ZoneSection = {
  group: string
  zone: string
  state: ZoneState | null
  /** Guests the engine attaches the group to, null when it cannot be told. */
  members: number | null
  rules: SecurityGroup['rules']
}

export function zoneSections(groups: SecurityGroup[], deployed: MicrosegSnapshot | null, guests: VMFirewallInfo[]): ZoneSection[] {
  return groups
    .filter(g => g.group.startsWith(ZONE_GROUP_PREFIX))
    .map(g => {
      const zone = g.group.slice(ZONE_GROUP_PREFIX.length)
      const state = deployed?.zones.find(z => z.name === zone)?.state ?? null
      const members = groupMembers(g.group, guests, deployed)
      return { group: g.group, zone, state, members: members.known ? members.members.length : null, rules: g.rules ?? [] }
    })
    .sort((a, b) => a.zone.localeCompare(b.zone))
}

export const UNTAGGED = '__untagged__'

/** Guests grouped by their first VLAN tag, numbered VLANs first, untagged last. */
export function vlanGroups(guests: VMFirewallInfo[]): [string, VMFirewallInfo[]][] {
  const map = new Map<string, VMFirewallInfo[]>()
  for (const vm of guests) {
    const key = vm.vlans.length > 0 ? String(vm.vlans[0]) : UNTAGGED
    const list = map.get(key) ?? []
    list.push(vm)
    map.set(key, list)
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === UNTAGGED) return 1
    if (b[0] === UNTAGGED) return -1
    return Number(a[0]) - Number(b[0])
  })
}

const norm = (s: string) => s.trim().toLowerCase()

/** The text a rule is searched in: addresses, ports, protocol, macro, group, action and comment. */
export function ruleMatches(rule: RuleFields, query: string): boolean {
  const q = norm(query)
  if (!q) return true
  return [rule.source, rule.dest, rule.proto, rule.dport, rule.sport, rule.macro, rule.action, rule.comment, rule.iface, ruleService(rule).label]
    .some(v => v.toLowerCase().includes(q))
}

export function guestMatches(vm: VMFirewallInfo, query: string): boolean {
  const q = norm(query)
  if (!q) return true
  return vm.name.toLowerCase().includes(q) || String(vm.vmid).includes(q) || vm.node.toLowerCase().includes(q) || vm.vlans.some(v => String(v).includes(q))
}

/** The service of a rule by name ("SSH" for tcp/22), the raw protocol and port for the tooltip. */
export function ruleService(rule: Pick<RuleFields, 'type' | 'macro' | 'proto' | 'dport'>): { label: string; raw: string } {
  if (rule.type === 'group') return { label: '-', raw: '' }
  if (rule.macro) return { label: rule.macro, raw: rule.macro }
  const proto = rule.proto.toLowerCase()
  if (!proto && !rule.dport) return { label: '', raw: '' }
  if (!proto) return { label: rule.dport, raw: rule.dport }
  return { label: serviceLabel(proto, rule.dport || undefined), raw: serviceTitle(proto, rule.dport || undefined) }
}

export const HITS_WINDOW_MS = 24 * 3600_000

export type HitsIndex = { counts: Map<string, number>; partial: boolean }

/**
 * Hits of the last 24 h per zone and per zone and service, from the engine's event ring (flows it logged towards
 * zone guests). `partial` when the ring page stopped before reaching 24 h back.
 */
export function hitsIndex(events: MicrosegEvent[], truncated: boolean, now: number): HitsIndex {
  const counts = new Map<string, number>()
  let oldest = Infinity
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1)
  for (const e of events) {
    const at = Date.parse(e.ts)
    if (Number.isFinite(at)) oldest = Math.min(oldest, at)
    if (!Number.isFinite(at) || now - at > HITS_WINDOW_MS) continue
    bump(`${e.zone}|*`)
    bump(`${e.zone}|${String(e.proto).toLowerCase()}/${e.dport}`)
  }
  return { counts, partial: truncated && oldest > now - HITS_WINDOW_MS }
}

/**
 * Flows blocked or would-block towards the zone in the last 24 h, null when the ring was not read. No ACCEPT rule of
 * the zone group matched them, so no rule of it has hits of its own: they belong to the zone's default deny row.
 */
export const zoneDenyHits = (index: HitsIndex | null, zone: string): number | null => (index ? index.counts.get(`${zone}|*`) ?? 0 : null)

/** The name a rule shows: its comment, else its place in the list. */
export const ruleName = (rule: RuleFields): string => rule.comment.trim()

/** Running guests whose firewall filters them, over the running guests (state known). */
export function coveredCount(guests: VMFirewallInfo[]): { covered: number; running: number } {
  const running = guests.filter(g => g.status === 'running' && !g.stateUnknown)
  return { covered: running.filter(g => g.firewallEnabled).length, running: running.length }
}
