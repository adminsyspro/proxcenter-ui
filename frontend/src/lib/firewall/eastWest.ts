/**
 * East-west flow resolution for the Micro-segmentation view.
 *
 * Turns the guests' firewall rule sets into VM-to-VM flows: a flow S -> T exists
 * when an active ACCEPT rule creates it, either an OUT rule on S whose
 * destination resolves to T, or an IN rule on T whose source resolves to S.
 * Rules of type `group` are expanded into the referenced security group's rules.
 * Source/dest references resolve through exact IPs, CIDRs, aliases and ipsets
 * against the guests' known addresses.
 *
 * On purpose this reads ACCEPT rules only: the view shows what is explicitly
 * allowed, it does not replay PVE's full first-match evaluation (a DROP placed
 * above an ACCEPT is not subtracted). Default-open guests (firewall disabled,
 * or an ACCEPT policy) are flagged per side instead, so the view never implies
 * a guest is sealed when its policy lets everything through.
 */

import type { Alias, FirewallRule, IPSet, SecurityGroup } from '@/lib/api/firewall'
import type { GuestNic } from '@/lib/proxmox/guestSegment'

/** A guest as flow resolution needs it: identity, addresses, policies, rules. */
export type EastWestGuest = {
  vmid: number
  name: string
  node: string
  type: 'qemu' | 'lxc'
  status: string
  /** IPv4/IPv6 addresses known for the guest (agent or config). Often 0 or 1. */
  ips: string[]
  firewallEnabled: boolean
  /** PVE VM defaults apply when unset: policy_in DROP, policy_out ACCEPT. */
  policyIn?: string
  policyOut?: string
  rules: FirewallRule[]
  /** Parsed NICs, display metadata only: flow resolution never reads them. */
  nics?: GuestNic[]
}

/** One end of a flow: a known guest, anything, or a reference no guest matches. */
export type FlowEndpoint =
  | { kind: 'vm'; vmid: number }
  | { kind: 'any' }
  | { kind: 'ref'; ref: string }

/** The rule a flow comes from: which guest carries it, on which side, via which SG. */
export type FlowOrigin = {
  vmid: number
  side: 'in' | 'out'
  pos: number
  /** Security group name when the rule was expanded out of one. */
  via?: string
  comment?: string
}

/** An allowed east-west flow, deduplicated across the rules that create it. */
export type EastWestFlow = {
  source: FlowEndpoint
  dest: FlowEndpoint
  proto?: string
  dport?: string
  macro?: string
  origins: FlowOrigin[]
}

/**
 * Whether a guest side lets traffic through without any explicit rule: firewall
 * off, or the side's policy not restrictive. PVE VM defaults are policy_in DROP
 * and policy_out ACCEPT when the options are unset.
 */
export function isOpenByDefault(guest: EastWestGuest, side: 'in' | 'out'): boolean {
  if (!guest.firewallEnabled) return true
  const policy = side === 'in' ? (guest.policyIn ?? 'DROP') : (guest.policyOut ?? 'ACCEPT')

  return policy === 'ACCEPT'
}

/** Strict IPv4 dotted-quad to integer; null for anything else (IPv6, names). */
function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null

  let value = 0
  for (let i = 1; i <= 4; i++) {
    const octet = Number.parseInt(m[i], 10)
    if (octet > 255) return null
    value = value * 256 + octet
  }

  return value
}

/**
 * Whether `ip` falls inside `cidr`. IPv4 only: a bare address is a /32, IPv6 is
 * matched by exact string equality elsewhere. Malformed input matches nothing.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf('/')
  const base = slash < 0 ? cidr : cidr.slice(0, slash)
  const prefix = slash < 0 ? 32 : Number.parseInt(cidr.slice(slash + 1), 10)

  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(base)
  if (ipInt === null || baseInt === null) return ip === cidr
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false

  // Compare the network prefixes; >>> keeps the math in unsigned 32-bit range.
  const shift = 32 - prefix

  return prefix === 0 || (ipInt >>> shift) === (baseInt >>> shift)
}

/** Lookup context shared by every reference resolution. */
export type ResolveContext = {
  guests: EastWestGuest[]
  aliasByName: Map<string, string>
  ipsetByName: Map<string, IPSet>
}

/** Build the shared lookup context once per resolution pass. */
export function buildResolveContext(guests: EastWestGuest[], aliases: Alias[], ipsets: IPSet[]): ResolveContext {
  return {
    guests,
    aliasByName: new Map(aliases.map(a => [a.name.toLowerCase(), a.cidr])),
    ipsetByName: new Map(ipsets.map(s => [s.name.toLowerCase(), s])),
  }
}

/** PVE lets rules reference cluster objects as `dc/<name>`; guests as `guest/<name>`. */
function stripScopePrefix(name: string): string {
  return name.replace(/^(dc|guest)\//, '')
}

/** The guests whose known addresses fall inside one CIDR (or exact IP). */
function guestsMatchingCidr(cidr: string, ctx: ResolveContext): number[] {
  const vmids: number[] = []
  for (const guest of ctx.guests) {
    if (guest.ips.some(ip => ip === cidr || ipInCidr(ip, cidr))) vmids.push(guest.vmid)
  }

  return vmids
}

/** The guests one reference token (IP, CIDR, alias, `+ipset`) resolves to. */
function guestsMatchingToken(token: string, ctx: ResolveContext): number[] {
  if (token.startsWith('+')) {
    const ipset = ctx.ipsetByName.get(stripScopePrefix(token.slice(1)).toLowerCase())
    if (!ipset) return []

    const vmids = new Set<number>()
    for (const member of ipset.members ?? []) {
      if (member.nomatch) continue
      const memberCidr = ctx.aliasByName.get(stripScopePrefix(member.cidr).toLowerCase()) ?? member.cidr
      for (const vmid of guestsMatchingCidr(memberCidr, ctx)) vmids.add(vmid)
    }

    return [...vmids]
  }

  const aliasCidr = ctx.aliasByName.get(stripScopePrefix(token).toLowerCase())

  return guestsMatchingCidr(aliasCidr ?? token, ctx)
}

/**
 * Resolve a rule's source/dest string to flow endpoints. An empty reference is
 * "match anything". Tokens that resolve to no known guest are folded into a
 * single `ref` endpoint so an external CIDR still shows up as one card instead
 * of disappearing.
 */
export function resolveRefEndpoints(ref: string | undefined, ctx: ResolveContext): FlowEndpoint[] {
  const trimmed = (ref ?? '').trim()
  if (!trimmed) return [{ kind: 'any' }]

  const vmids = new Set<number>()
  const unmatched: string[] = []
  for (const rawToken of trimmed.split(',')) {
    const token = rawToken.trim()
    if (!token) continue

    const matches = guestsMatchingToken(token, ctx)
    if (matches.length === 0) unmatched.push(token)
    for (const vmid of matches) vmids.add(vmid)
  }

  const endpoints: FlowEndpoint[] = [...vmids].map(vmid => ({ kind: 'vm', vmid }))
  if (unmatched.length > 0) endpoints.push({ kind: 'ref', ref: unmatched.join(', ') })

  return endpoints
}

/** A guest's own rules with its `group` rows expanded into the SG's rules. */
export function expandGuestRules(
  guest: EastWestGuest,
  securityGroups: SecurityGroup[],
): Array<{ rule: FirewallRule; via?: string }> {
  const sgByName = new Map(securityGroups.map(sg => [sg.group, sg]))

  const expanded: Array<{ rule: FirewallRule; via?: string }> = []
  for (const rule of guest.rules) {
    if (rule.type !== 'group') {
      expanded.push({ rule })
      continue
    }
    if (rule.enable !== 1) continue

    // A group row activates the SG's rules on this guest; `action` names the SG.
    for (const sgRule of sgByName.get(rule.action)?.rules ?? []) {
      expanded.push({ rule: sgRule, via: rule.action })
    }
  }

  return expanded
}

function flowKey(flow: EastWestFlow): string {
  const endpointKey = (endpoint: FlowEndpoint) =>
    endpoint.kind === 'vm' ? `vm:${endpoint.vmid}` : endpoint.kind === 'ref' ? `ref:${endpoint.ref}` : 'any'

  return [endpointKey(flow.source), endpointKey(flow.dest), flow.proto ?? '', flow.dport ?? '', flow.macro ?? ''].join('|')
}

/**
 * Resolve every active ACCEPT rule of every guest into east-west flows.
 * Flows identical in endpoints and service are merged, keeping every origin,
 * so a connection allowed on both sides renders as one card.
 */
export function buildEastWestFlows(
  guests: EastWestGuest[],
  securityGroups: SecurityGroup[],
  aliases: Alias[],
  ipsets: IPSet[],
): EastWestFlow[] {
  const ctx = buildResolveContext(guests, aliases, ipsets)

  const byKey = new Map<string, EastWestFlow>()
  const add = (flow: EastWestFlow) => {
    const existing = byKey.get(flowKey(flow))
    if (existing) existing.origins.push(...flow.origins)
    else byKey.set(flowKey(flow), flow)
  }

  for (const guest of guests) {
    for (const { rule, via } of expandGuestRules(guest, securityGroups)) {
      if (rule.enable !== 1 || rule.action !== 'ACCEPT') continue
      if (rule.type !== 'in' && rule.type !== 'out') continue

      const self: FlowEndpoint = { kind: 'vm', vmid: guest.vmid }
      const origin: FlowOrigin = {
        vmid: guest.vmid,
        side: rule.type,
        pos: rule.pos,
        ...(via ? { via } : {}),
        ...(rule.comment ? { comment: rule.comment } : {}),
      }
      const service = {
        ...(rule.proto ? { proto: rule.proto } : {}),
        ...(rule.dport ? { dport: rule.dport } : {}),
        ...(rule.macro ? { macro: rule.macro } : {}),
      }

      // An OUT rule on S names destinations; an IN rule on T names sources.
      const others = resolveRefEndpoints(rule.type === 'out' ? rule.dest : rule.source, ctx)
      for (const other of others) {
        if (other.kind === 'vm' && other.vmid === guest.vmid) continue // self-loop, nothing east-west
        const flow: EastWestFlow = rule.type === 'out'
          ? { source: self, dest: other, ...service, origins: [origin] }
          : { source: other, dest: self, ...service, origins: [origin] }

        add(flow)
      }
    }
  }

  return [...byKey.values()]
}

/** The flows explicitly leaving a guest (it is the resolved source). */
export function flowsFromGuest(flows: EastWestFlow[], vmid: number): EastWestFlow[] {
  return flows.filter(f => f.source.kind === 'vm' && f.source.vmid === vmid)
}

/** The flows reaching a guest (it is the destination). */
export function flowsToGuest(flows: EastWestFlow[], vmid: number): EastWestFlow[] {
  return flows.filter(f => f.dest.kind === 'vm' && f.dest.vmid === vmid)
}
