// Client-side checks of the zone and flow forms. They mirror the orchestrator's
// ValidateZoneName / ValidateFlow (internal/microseg/validate.go), so a mistake
// is shown at once instead of coming back as a 400. The server stays the
// authority. Errors are i18n keys, one per field.

import type { EgressMode, EgressState, ZoneState } from '@/lib/microseg/types'

import type { ExceptionDraft } from './exceptionModel'

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
  /** The inbound state chosen in the dialog (a new zone stays disabled). */
  state: ZoneState
  /** The outbound state chosen in the dialog; ignored while `state` is disabled (the backend turns the outbound off). */
  egress_state: EgressState
  egress_mode: EgressMode
  /** The address of the router of the zone's network, empty when unknown. */
  gateway: string
  /** What the zone may reach on its gateway, a listed service or a typed one ("tcp/8443"): a flow is created for each one it does not have yet. */
  gateway_services: string[]
  /** The exceptions of the zone as the dialog leaves them: one without id is created, one that differs from the stored one is updated. */
  exceptions: ExceptionDraft[]
  /** The ids of the stored exceptions the dialog removed. Only these are deleted: an exception the dialog never listed stays. */
  removed_exceptions: string[]
}

/**
 * The services a zone may reach on its gateway, offered in the zone dialog: what a router or firewall usually serves
 * (name resolution, time, reachability, its web and SSH administration, SNMP, syslog, a web proxy), or everything.
 */
export const GATEWAY_SERVICES = ['dns', 'ntp', 'ping', 'http', 'https', 'ssh', 'snmp', 'syslog', 'proxy', 'all'] as const
export type GatewayService = (typeof GATEWAY_SERVICES)[number]

/** Ticked for a zone that has no gateway yet: what a zone needs even with its outbound blocked. */
export const DEFAULT_GATEWAY_SERVICES: readonly GatewayService[] = ['dns', 'ntp', 'ping']

const GATEWAY_SERVICE_FLOWS: Record<Exclude<GatewayService, 'ping'>, { proto: string; dport: string }[]> = {
  dns: [{ proto: 'udp', dport: '53' }, { proto: 'tcp', dport: '53' }],
  ntp: [{ proto: 'udp', dport: '123' }],
  http: [{ proto: 'tcp', dport: '80' }],
  https: [{ proto: 'tcp', dport: '443' }],
  ssh: [{ proto: 'tcp', dport: '22' }],
  snmp: [{ proto: 'udp', dport: '161' }],
  syslog: [{ proto: 'udp', dport: '514' }],
  proxy: [{ proto: 'tcp', dport: '3128' }],
  all: [{ proto: 'any', dport: '' }],
}

export const isGatewayService = (choice: string): choice is GatewayService => (GATEWAY_SERVICES as readonly string[]).includes(choice)

/**
 * A service typed in the zone dialog, as the flow dialog takes it: "tcp/8443", "udp/5000:5010", "tcp/80,443", or a
 * protocol without port ("icmp", "icmpv6", "any"); null when it is none of them.
 */
export function parseTypedService(text: string): { proto: string; dport: string } | null {
  // "tcp 8443" and "TCP / 8443" are "tcp/8443".
  const value = text.trim().toLowerCase().replace(/^(tcp|udp)\s*[\s/]\s*/, '$1/').replace(/\s+/g, '')
  const [proto, ports, extra] = value.split('/')
  if (extra !== undefined) return null
  if (proto === 'tcp' || proto === 'udp') return ports && validPorts(ports) ? { proto, dport: ports } : null
  return ports === undefined && (proto === 'icmp' || proto === 'icmpv6' || proto === 'any') ? { proto, dport: '' } : null
}

/**
 * What the list offers for a text being typed: the service it is ("tcp 8443" offers "tcp/8443"), or for ports alone
 * ("8443", "5000:5010") the TCP and the UDP service; nothing for anything else.
 */
export function typedServiceCandidates(text: string): string[] {
  const one = typedServiceText(text)
  // "any" is the listed "All protocols", which the filter shows already.
  if (one === 'any') return []
  if (one) return [one]
  const ports = text.trim().replace(/\s+/g, '')
  return ports && validPorts(ports) ? [`tcp/${ports}`, `udp/${ports}`] : []
}

/** The canonical text of a typed service ("TCP / 8443" is "tcp/8443"), null when it is not one. */
export function typedServiceText(text: string): string | null {
  const s = parseTypedService(text)
  return s && (s.dport ? `${s.proto}/${s.dport}` : s.proto)
}

/** The flows of a gateway service: DNS answers over UDP and TCP, the ping of an IPv6 gateway is ICMPv6; a typed service is its own flow. */
export function gatewayServiceFlows(choice: string, gateway: string): { proto: string; dport: string }[] {
  if (choice === 'ping') return [{ proto: gateway.includes(':') ? 'icmpv6' : 'icmp', dport: '' }]
  if (isGatewayService(choice)) return GATEWAY_SERVICE_FLOWS[choice as Exclude<GatewayService, 'ping'>]
  const typed = parseTypedService(choice)
  return typed ? [typed] : []
}

/** The ports of a service as the list shows them: "udp/53, tcp/53", "icmp". */
export const gatewayServicePorts = (choice: string, gateway: string) =>
  gatewayServiceFlows(choice, gateway).map(f => (f.dport ? `${f.proto}/${f.dport}` : f.proto)).join(', ')

/** The host prefix of a gateway, as a flow names it: "10.30.0.1/32", "2001:db8::1/128". */
export const gatewayCidr = (gateway: string) => `${gateway}/${gateway.includes(':') ? 128 : 32}`

export function validateZoneForm(v: ZoneFormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!v.name) errors.name = `${V}.nameRequired`
  else if (!ZONE_NAME_RE.test(v.name)) errors.name = `${V}.nameInvalid`
  if (v.color && !/^#[0-9a-f]{6}$/i.test(v.color)) errors.color = `${V}.colorInvalid`
  if (v.gateway.trim() && !isIpAddress(v.gateway.trim())) errors.gateway = `${V}.gatewayInvalid`
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
