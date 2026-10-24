// src/lib/firewall/logParse.ts
// Reads the lines of /var/log/pve-firewall.log as PVE's API hands them out
// (ui#1114). A line is `VMID LEVEL CHAIN TIMESTAMP [policy] [ACTION: ]FIELDS`:
//
//   101 6 veth101i0-IN 15/Oct/2026:22:59:45 +0200 ACCEPT: IN=fwbr101i0 ... DPT=22
//   0 6 GROUP-web-IN 15/Oct/2026:22:59:42 +0200 IN=fwbr101i0 ... DPT=9999
//   0 6 group-web-in 15/Oct/2026:23:00:39 +0200 DROP: OUT=fwbr101i0 ... DPT=9999
//
// Two PVE facts shape this module, both measured on PVE 9.2:
// - a security group rule logs with VMID 0, so the guest is only known
//   through the interface (tap/veth/fwln<vmid>i<n>);
// - the iptables backend writes no action word on a group rule (PVE sets
//   `logmsg` for VM, host and cluster rules, not in generate_group_rules),
//   so ACCEPT and DROP read the same. `inferGroupAction` recovers it from the
//   group's rules when exactly one outcome fits. nftables writes the action.

import type { Alias, FirewallRule, IPSet } from '@/lib/api/firewall'

export type LogAction = 'ACCEPT' | 'DROP' | 'REJECT'
export type LogDirection = 'in' | 'out'

export interface ParsedLogLine {
  vmid: number
  level: number
  chain: string
  /** Epoch milliseconds. */
  ts: number
  action?: LogAction
  /** The chain's default policy, not a rule, decided. */
  policy: boolean
  direction?: LogDirection
  /** Set when the chain is a security group's. */
  group?: string
  /** Guest owning the interface, from tap/veth/fwln<vmid>i<n>. */
  guestVmid?: number
  /** NIC index of that interface (`i0` → 0), i.e. netN. */
  guestNic?: number
  src?: string
  dst?: string
  proto?: string
  sport?: number
  dport?: number
  icmpType?: number
  fields: Record<string, string>
  /** Bare tokens of the packet: IP and TCP flags (DF, SYN, ACK…). */
  flags: string[]
  raw: string
}

const LINE_RE = /^(\d+) (\d) (\S+) (\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2}) (.*)$/
const ACTION_RE = /^(policy )?(ACCEPT|DROP|REJECT): ?/
const GROUP_CHAIN_RE = /^group-(.+)-(in|out)$/i
const DIRECTION_RE = /-(in|out)$/i
const GUEST_IFACE_RE = /^(?:tap|veth|fwln|fwpr)(\d+)i(\d+)$/
const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }

const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined)

/** Epoch milliseconds of a matched line, undefined for an unknown month. */
function lineTime(m: RegExpExecArray): number | undefined {
  const [, , , , day, mon, year, hh, mm, ss, sign, tzh, tzm] = m

  if (MONTHS[mon] === undefined) return undefined

  const offsetMin = (sign === '-' ? -1 : 1) * (Number(tzh) * 60 + Number(tzm))

  return Date.UTC(Number(year), MONTHS[mon], Number(day), Number(hh), Number(mm), Number(ss)) - offsetMin * 60_000
}

/**
 * Epoch milliseconds of any log line, the logger's own start/stop lines
 * included; undefined for PVE's "no content" placeholder and garbage.
 */
export function logLineTime(raw: string): number | undefined {
  const m = LINE_RE.exec(raw)

  return m ? lineTime(m) : undefined
}

/**
 * Parses one log line. Returns null for what is not a packet: the logger's
 * own start/stop lines (chain `-`), PVE's "no content" placeholder, garbage.
 */
export function parseFirewallLogLine(raw: string): ParsedLogLine | null {
  const m = LINE_RE.exec(raw)

  if (!m) return null

  const [, vmid, level, chain] = m
  const rest = m[13]
  const ts = lineTime(m)

  if (chain === '-' || ts === undefined) return null

  let body = rest
  let action: LogAction | undefined
  let policy = false
  const a = ACTION_RE.exec(body)

  if (a) {
    policy = !!a[1]
    action = a[2] as LogAction
    body = body.slice(a[0].length)
  }

  const fields: Record<string, string> = {}
  const flags: string[] = []

  for (const token of body.split(' ')) {
    const eq = token.indexOf('=')

    if (eq < 0 && /^[A-Z]+$/.test(token)) flags.push(token)
    if (eq <= 0) continue
    const key = token.slice(0, eq)

    // ICMP repeats ID= after the IP header's: keep the first (IP) one.
    if (!(key in fields)) fields[key] = token.slice(eq + 1)
  }

  const g = GROUP_CHAIN_RE.exec(chain)
  const d = DIRECTION_RE.exec(chain)

  let guestVmid: number | undefined
  let guestNic: number | undefined

  for (const key of ['PHYSIN', 'PHYSOUT', 'IN', 'OUT']) {
    const iface = GUEST_IFACE_RE.exec(fields[key] || '')

    if (iface) {
      guestVmid = Number(iface[1])
      guestNic = Number(iface[2])
      break
    }
  }

  const proto = fields.PROTO

  return {
    vmid: Number(vmid),
    level: Number(level),
    chain,
    ts,
    action,
    policy,
    direction: d ? (d[1].toLowerCase() as LogDirection) : undefined,
    group: g ? g[1] : undefined,
    guestVmid,
    guestNic,
    src: fields.SRC,
    dst: fields.DST,
    proto,
    sport: num(fields.SPT),
    dport: num(fields.DPT),
    icmpType: proto && /^icmp/i.test(proto) ? num(fields.TYPE) : undefined,
    fields,
    flags,
    raw,
  }
}

// ================================================================================
// ACTION INFERENCE (iptables group lines)
// ================================================================================

/** pve-firewall's log level names, numbered as they appear on the line. */
const LOG_LEVELS: Record<string, number> = { emerg: 0, alert: 1, crit: 2, err: 3, warning: 4, notice: 5, info: 6, debug: 7 }

/** The level name of a line's level number, as the rule's `log` field spells it. */
export const logLevelName = (level: number) => Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level)

const PROTO_NUMBERS: Record<string, string> = { '1': 'icmp', '6': 'tcp', '17': 'udp', '58': 'ipv6-icmp' }

type Match = 'yes' | 'maybe' | 'no'

function and(...ms: Match[]): Match {
  if (ms.includes('no')) return 'no'

  return ms.includes('maybe') ? 'maybe' : 'yes'
}

function normProto(p: string): string {
  const v = (PROTO_NUMBERS[p] || p).toLowerCase()

  return v === 'icmpv6' ? 'ipv6-icmp' : v
}

function matchProto(rule: string | undefined, line: string | undefined): Match {
  if (!rule) return 'yes'
  if (!line) return 'maybe'

  return normProto(rule) === normProto(line) ? 'yes' : 'no'
}

/** `80`, `80,443`, `1000:2000`; a service name (`ssh`) cannot be resolved here. */
function matchPort(rule: string | undefined, port: number | undefined): Match {
  if (!rule) return 'yes'
  if (port === undefined) return 'no' // PVE only allows ports on tcp/udp, which always log them

  let result: Match = 'no'

  for (const part of rule.split(',').map(s => s.trim()).filter(Boolean)) {
    const range = /^(\d+)(?::(\d+))?$/.exec(part)

    if (!range) {
      result = 'maybe'
      continue
    }
    const lo = Number(range[1])
    const hi = range[2] !== undefined ? Number(range[2]) : lo

    if (port >= lo && port <= hi) return 'yes'
  }

  return result
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')

  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null

  return parts.reduce((acc, p) => acc * 256 + Number(p), 0)
}

/** One address term: IP, CIDR or `a-b` range. IPv6 is compared as text only. */
function matchAddressTerm(term: string, ip: string): Match {
  const range = /^([^-]+)-([^-]+)$/.exec(term)

  if (range) {
    const [lo, hi, v] = [ipv4ToInt(range[1]), ipv4ToInt(range[2]), ipv4ToInt(ip)]

    if (lo === null || hi === null || v === null) return 'maybe'

    return v >= lo && v <= hi ? 'yes' : 'no'
  }

  const [base, bitsStr] = term.split('/')
  const v = ipv4ToInt(ip)
  const b = ipv4ToInt(base)

  if (v === null || b === null) {
    if (bitsStr === undefined && base.toLowerCase() === ip.toLowerCase()) return 'yes'

    return base.includes(':') || ip.includes(':') ? 'maybe' : 'no'
  }

  const bits = bitsStr === undefined ? 32 : Number(bitsStr)

  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return 'maybe'
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0

  return ((v & mask) >>> 0) === ((b & mask) >>> 0) ? 'yes' : 'no'
}

export interface AddressBook {
  aliases: Alias[]
  ipsets: IPSet[]
}

/** Strips PVE's scope prefix: `dc/name`, `guest/name`. */
const unscoped = (name: string) => name.replace(/^(dc|guest)\//, '')

function matchAddress(rule: string | undefined, ip: string | undefined, book: AddressBook): Match {
  if (!rule) return 'yes'
  if (!ip) return 'maybe'

  let result: Match = 'no'

  for (const term of rule.split(',').map(s => s.trim()).filter(Boolean)) {
    let m: Match

    if (term.startsWith('+')) {
      const set = book.ipsets.find(s => s.name === unscoped(term.slice(1)))

      // nomatch entries carve holes we do not model: never claim a sure match.
      if (!set?.members || set.members.some(e => e.nomatch)) m = 'maybe'
      else m = set.members.reduce<Match>((acc, e) => (acc === 'yes' ? acc : best(acc, matchAddressTerm(e.cidr, ip))), 'no')
    } else if (/^[A-Za-z]/.test(term) && !term.includes(':')) {
      const alias = book.aliases.find(al => al.name === unscoped(term))

      m = alias ? matchAddressTerm(alias.cidr, ip) : 'maybe'
    } else {
      m = matchAddressTerm(term, ip)
    }

    if (m === 'yes') return 'yes'
    result = best(result, m)
  }

  return result
}

function best(a: Match, b: Match): Match {
  if (a === 'yes' || b === 'yes') return 'yes'

  return a === 'maybe' || b === 'maybe' ? 'maybe' : 'no'
}

function matchIface(rule: string | undefined, nic: number | undefined): Match {
  if (!rule) return 'yes'
  if (nic === undefined) return 'maybe'

  return rule === `net${nic}` ? 'yes' : 'no'
}

function ruleMatches(rule: FirewallRule, line: ParsedLogLine, book: AddressBook): Match {
  // A macro expands to proto/port sets PVE keeps server side.
  if (rule.macro) return 'maybe'

  return and(
    matchProto(rule.proto, line.proto),
    matchPort(rule.dport, line.dport),
    matchPort(rule.sport, line.sport),
    matchAddress(rule.source, line.src, book),
    matchAddress(rule.dest, line.dst, book),
    matchIface(rule.iface, line.guestNic),
  )
}

/**
 * The rules that may have written a line, by position, in rule order. PVE
 * never logs which rule matched, so this is a deduction: only enabled rules
 * of the line's direction, logging at the line's level (and of the line's
 * action, when PVE wrote one) can have written it. Walking them in order, the
 * first sure match ends the search; an earlier "maybe" stays a candidate.
 * Group references (`type: group`) are skipped: their hits log in the group.
 */
export function ruleCandidates(line: ParsedLogLine, rules: FirewallRule[], book: AddressBook): number[] {
  if (!line.direction) return []

  const positions: number[] = []

  for (const rule of rules) {
    if (Number(rule.enable) !== 1 || rule.type !== line.direction) continue
    if (!rule.log || rule.log === 'nolog' || LOG_LEVELS[rule.log] !== line.level) continue
    if (line.action && rule.action !== line.action) continue

    const m = ruleMatches(rule, line, book)

    if (m === 'no') continue
    positions.push(rule.pos)
    if (m === 'yes') break
  }

  return positions
}

/**
 * The action of a group rule hit the iptables backend logged without one:
 * defined only when every candidate rule agrees, so a guess is never shown.
 */
export function inferGroupAction(line: ParsedLogLine, rules: FirewallRule[], book: AddressBook): LogAction | undefined {
  const candidates = ruleCandidates({ ...line, action: undefined }, rules, book)
  const actions = new Set(candidates.map(pos => rules.find(r => r.pos === pos)?.action))

  if (actions.size !== 1) return undefined
  const [action] = [...actions]

  return action === 'ACCEPT' || action === 'DROP' || action === 'REJECT' ? action : undefined
}
