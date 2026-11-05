// Client-side checks of the zone and flow forms. They mirror the orchestrator's
// ValidateZoneName / ValidateFlow (internal/microseg/validate.go), so a mistake
// is shown at once instead of coming back as a 400. The server stays the
// authority. Errors are i18n keys, one per field.

import type { EgressMode } from '@/lib/microseg/types'

const V = 'microsegPilot.policy.validation'

export const ZONE_NAME_RE = /^[a-z][a-z0-9-]{0,13}$/

/** The colors a zone can take: a small fixed palette, no free color picker. */
export const ZONE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b',
] as const

export const FLOW_PROTOS = ['tcp', 'udp', 'icmp', 'icmpv6', 'any'] as const

export type ZoneFormValues = {
  name: string
  label: string
  color: string
  isolate_members: boolean
  /** The outbound is observed or enforced (the checkbox); an enforced outbound counts as checked. */
  egress_control: boolean
  egress_mode: EgressMode
}

export function validateZoneForm(v: ZoneFormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!v.name) errors.name = `${V}.nameRequired`
  else if (!ZONE_NAME_RE.test(v.name)) errors.name = `${V}.nameInvalid`
  if (v.color && !/^#[0-9a-f]{6}$/i.test(v.color)) errors.color = `${V}.colorInvalid`
  return errors
}

export type FlowFormValues = {
  src_zone_id?: string
  src_cidr?: string
  dst_zone_id?: string
  dst_cidr?: string
  proto: string
  dport: string
}

type Prefix = { groups: number[]; width: 8 | 16; length: number }

function parseV4(addr: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr)
  if (!m) return null
  const octets = m.slice(1).map(o => (o.length > 1 && o.startsWith('0') ? NaN : Number(o)))
  return octets.every(o => o >= 0 && o <= 255) ? octets : null
}

function parseV6(addr: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(addr)) return null
  const halves = addr.split('::')
  if (halves.length > 2) return null
  const toGroups = (s: string) => (s === '' ? [] : s.split(':'))
  const head = toGroups(halves[0])
  const tail = halves.length === 2 ? toGroups(halves[1]) : []
  const all = [...head, ...tail]
  if (!all.every(g => /^[0-9a-f]{1,4}$/i.test(g))) return null
  if (halves.length === 1 ? head.length !== 8 : all.length > 7) return null
  const zeros = halves.length === 2 ? Array(8 - all.length).fill(0) : []
  return [...head, ...zeros, ...tail].map(g => (typeof g === 'number' ? g : Number.parseInt(g, 16)))
}

/** True for a plain IPv4 or IPv6 address (no zone, no prefix), as the orchestrator's netip.ParseAddr takes it. */
export function isIpAddress(value: string): boolean {
  return parseV4(value) !== null || (value.includes(':') && parseV6(value) !== null)
}

function parsePrefix(cidr: string): Prefix | null {
  const [addr, len, extra] = cidr.split('/')
  if (extra !== undefined || len === undefined || !/^(0|[1-9]\d{0,2})$/.test(len)) return null
  const length = Number(len)
  const v4 = parseV4(addr)
  if (v4) return length <= 32 ? { groups: v4, width: 8, length } : null
  const v6 = addr.includes(':') ? parseV6(addr) : null
  return v6 && length <= 128 ? { groups: v6, width: 16, length } : null
}

function maskGroups({ groups, width, length }: Prefix): number[] {
  return groups.map((g, i) => {
    const kept = Math.min(Math.max(length - i * width, 0), width)
    if (kept === 0) return 0
    return g & (((1 << kept) - 1) << (width - kept))
  })
}

function formatV6(groups: number[]): string {
  let best = { start: -1, len: 0 }
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== 0) { i++; continue }
    let j = i
    while (j < groups.length && groups[j] === 0) j++
    if (j - i > best.len) best = { start: i, len: j - i }
    i = j
  }
  const hex = groups.map(g => g.toString(16))
  if (best.len < 2) return hex.join(':')
  return `${hex.slice(0, best.start).join(':')}::${hex.slice(best.start + best.len).join(':')}`
}

/** The form of a CIDR with its host bits cleared, or null when it has none (or is not a CIDR). */
export function maskedCidr(cidr: string): string | null {
  const p = parsePrefix(cidr)
  if (!p) return null
  const masked = maskGroups(p)
  if (masked.every((g, i) => g === p.groups[i])) return null
  return `${p.width === 8 ? masked.join('.') : formatV6(masked)}/${p.length}`
}

function validateSide(zoneId: string, cidr: string): string | null {
  if (!zoneId && !cidr) return `${V}.sideRequired`
  if (zoneId && cidr) return `${V}.sideBoth`
  if (!cidr) return null
  if (!parsePrefix(cidr)) return `${V}.cidrInvalid`
  return maskedCidr(cidr) ? `${V}.cidrHostBits` : null
}

function validPorts(spec: string): boolean {
  const port = (s: string) => /^\d{1,5}$/.test(s) && Number(s) >= 1 && Number(s) <= 65535
  return spec.split(',').every(part => {
    const bounds = part.split(':')
    if (bounds.length === 1) return port(bounds[0])
    return bounds.length === 2 && port(bounds[0]) && port(bounds[1]) && Number(bounds[1]) >= Number(bounds[0])
  })
}

export function validateFlowForm(v: FlowFormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  const src = validateSide(v.src_zone_id ?? '', v.src_cidr ?? '')
  const dst = validateSide(v.dst_zone_id ?? '', v.dst_cidr ?? '')
  if (src) errors.src = src
  if (dst) errors.dst = dst
  if (!errors.src && !errors.dst && v.src_cidr && v.dst_cidr) errors.dst = `${V}.cidrBoth`

  if (!(FLOW_PROTOS as readonly string[]).includes(v.proto)) {
    errors.proto = `${V}.protoInvalid`
  } else if (v.proto === 'tcp' || v.proto === 'udp') {
    if (v.dport && !validPorts(v.dport)) errors.dport = `${V}.portInvalid`
  } else if (v.dport) {
    errors.dport = `${V}.portNotAllowed`
  }
  return errors
}
