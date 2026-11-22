// What a preflight check says, as i18n keys and values. The ids and the detail
// keys are the orchestrator's (internal/microseg/preflight.go); an id this
// version does not know is shown by its id, without a detail.

import type { PreflightCheck } from '@/lib/microseg/types'

export type PreflightMessage = {
  /** Under microsegPilot.preflight.checks, or null for an unknown id (shown as the id). */
  title: string | null
  /** Under microsegPilot.preflight, with its values, or null when the check says nothing more. */
  detail: { key: string; values?: Record<string, string | number> } | null
  /** Further sentences under microsegPilot.preflight, said after the detail (every reason of a socle failure). */
  more?: Array<{ key: string; values?: Record<string, string | number> }>
  /** What joins the detail and the further sentences on the line; a space when absent. */
  joiner?: string
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function socleMissing(detail: Record<string, unknown>): string {
  const missing = [detail.web === false ? '8006' : '', detail.ssh === false ? '22' : ''].filter(Boolean)
  return missing.length > 0 ? missing.join(', ') : '8006, 22'
}

/** The guests a check names, as "qemu/101, lxc/202". */
function guestList(value: unknown): string {
  const refs = Array.isArray(value) ? value : []
  return refs
    .map(g => (g && typeof g === 'object' ? `${text((g as Record<string, unknown>).type)}/${String((g as Record<string, unknown>).vmid ?? '')}` : ''))
    .filter(Boolean)
    .join(', ')
}

type SocleReason = { reason: string; group: string; node: string }

/** Every reason of a socle failure: the `reasons` list, or the single `reason` of an older orchestrator. */
function socleReasons(detail: Record<string, unknown>): SocleReason[] {
  const list = Array.isArray(detail.reasons) ? detail.reasons : [{ reason: detail.reason, group: detail.group, node: detail.node }]
  return list
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => ({ reason: text(r.reason), group: text(r.group), node: text(r.node) }))
    .filter(r => r.reason !== '')
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value : []).filter((v): v is string => typeof v === 'string')

type Line = { key: string; values?: Record<string, string> }

/**
 * The sentences of a socle failure, under microsegPilot.preflight: one per
 * reason (Docker address, node rules or security group that could not be
 * read), and the addresses and nodes left uncovered (the nodes whose rules
 * could not be read are already said).
 */
function socleLines(detail: Record<string, unknown>, ports: string): { reasons: Line[]; uncovered: Line | null } {
  const reasons: Line[] = []
  const unreadableNodes = new Set<string>()
  for (const r of socleReasons(detail)) {
    if (r.reason === 'docker_internal') reasons.push({ key: 'checks.socle_rules.dockerInternal', values: { ports } })
    else if (r.reason === 'group_unreadable') reasons.push({ key: 'checks.socle_rules.groupUnreadable', values: { group: r.group } })
    else if (r.reason === 'host_rules_unreadable') {
      unreadableNodes.add(r.node)
      reasons.push({ key: 'checks.socle_rules.hostRulesUnreadable', values: { node: r.node } })
    }
  }
  const ips = strings(detail.uncovered)
  const nodes = strings(detail.uncovered_nodes).filter(n => !unreadableNodes.has(n))
  let uncovered: Line | null = null
  if (ips.length > 0 && nodes.length > 0) uncovered = { key: 'checks.socle_rules.missingForNodes', values: { ports, ips: ips.join(', '), nodes: nodes.join(', ') } }
  else if (ips.length > 0) uncovered = { key: 'checks.socle_rules.missingFor', values: { ports, ips: ips.join(', ') } }
  else if (nodes.length > 0) uncovered = { key: 'checks.socle_rules.missingOn', values: { ports, nodes: nodes.join(', ') } }
  return { reasons, uncovered }
}

function socleMessage(detail: Record<string, unknown>): PreflightMessage['detail'] & { more?: Line[] } {
  const ports = socleMissing(detail)
  const { reasons, uncovered } = socleLines(detail, ports)
  // The Docker sentence already says the ports are not open for ProxCenter: no generic line besides.
  const docker = reasons.some(r => r.key === 'checks.socle_rules.dockerInternal')
  const lines = [...reasons, ...(uncovered && !docker ? [uncovered] : [])]
  if (lines.length === 0) return { key: 'checks.socle_rules.missing', values: { ports } }
  const [first, ...more] = lines
  return more.length > 0 ? { ...first, more } : first
}

const TRAFFIC_KINDS = new Set(['ceph_public', 'ceph_cluster', 'migration'])

/**
 * The sentences of a node traffic check, under microsegPilot.preflight: one per network the nodes' own firewalls would
 * cut (`blocked`) or that a rule left undecided (`unsure`), each with its ports and its nodes.
 */
function trafficLines(detail: Record<string, unknown>, from: 'blocked' | 'unsure'): Line[] {
  const list = Array.isArray(detail[from]) ? detail[from] : []
  return list
    .filter((n): n is Record<string, unknown> => !!n && typeof n === 'object')
    .map(n => {
      const kind = text(n.kind)
      return {
        key: `checks.node_traffic.${from === 'blocked' ? 'cut' : 'doubt'}.${TRAFFIC_KINDS.has(kind) ? kind : 'other'}`,
        values: { network: text(n.network), ports: text(n.ports), nodes: strings(n.nodes).join(', ') },
      }
    })
}

function trafficMessage(check: PreflightCheck, detail: Record<string, unknown>): PreflightMessage['detail'] & { more?: Line[] } {
  if (check.status === 'pass') {
    if (detail.node_firewalls === 'off') return { key: 'checks.node_traffic.nodesOff' }
    return { key: detail.policy_in === 'ACCEPT' ? 'checks.node_traffic.policyAccept' : 'checks.node_traffic.pass' }
  }
  const cut = trafficLines(detail, 'blocked')
  const doubt = trafficLines(detail, 'unsure')
  const lines = [
    ...cut,
    ...(cut.length > 0 ? [{ key: 'checks.node_traffic.fix' }] : []),
    ...doubt,
    ...(doubt.length > 0 ? [{ key: 'checks.node_traffic.doubtWhy' }] : []),
  ]
  if (lines.length === 0) return { key: 'checks.node_traffic.fix' }
  const [first, ...more] = lines
  return more.length > 0 ? { ...first, more } : first
}

/** A refusal to turn the cluster firewall on because the nodes' own firewalls would cut what the nodes exchange. */
export function isTrafficRefusal(detail: Record<string, unknown> | undefined): boolean {
  return !!detail && Array.isArray(detail.blocked) && detail.blocked.length > 0
}

/** The counts of the IP filter check a warning names, in the order it says them. */
export const IP_FILTER_PARTS = ['no_address', 'held', 'unknown', 'manual', 'excluded', 'dhcp'] as const

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

/**
 * The IP filter check: how many members are ready, or, on a warning, each count that is not zero ("2 without a known
 * address, 1 address held, 3 on DHCP"), or that nothing is computed before a check has run (on a cluster the engine does
 * not run yet: before the first application).
 */
function ipFilterMessage(check: PreflightCheck, detail: Record<string, unknown>): Found {
  if (detail.reason === 'not_checked') return { key: 'checks.ip_filter.notChecked' }
  // On a cluster the engine does not run yet a check run is refused: the first application computes it.
  if (detail.reason === 'not_deployed') return { key: 'checks.ip_filter.notDeployed' }
  const ready = { key: 'checks.ip_filter.pass', values: { count: count(detail.ready) } }
  if (check.status === 'pass') return ready
  const parts = IP_FILTER_PARTS.filter(part => count(detail[part]) > 0).map(part => ({ key: `checks.ip_filter.part.${part}`, values: { count: count(detail[part]) } }))
  if (parts.length === 0) return ready
  const [first, ...more] = parts
  return more.length > 0 ? { ...first, more, joiner: ', ' } : first
}

type Found = NonNullable<PreflightMessage['detail']> & { more?: PreflightMessage['more']; joiner?: string }

function detailOf(check: PreflightCheck): Found | null {
  const detail = check.detail ?? {}
  const error = text(detail.error)
  if (check.status === 'fail' && error) return { key: 'readFailed', values: { error } }

  switch (check.id) {
    case 'cluster_firewall':
      if (heldByStop(check)) return { key: 'checks.cluster_firewall.heldByStop' }
      return { key: check.status === 'pass' ? 'checks.cluster_firewall.pass' : 'checks.cluster_firewall.off' }
    case 'firewall_service':
      if (check.status === 'pass') return { key: 'checks.firewall_service.pass' }
      if (check.status === 'warn') return { key: 'checks.firewall_service.unreadable', values: { nodes: strings(detail.unreadable).join(', ') } }
      return { key: 'checks.firewall_service.stopped', values: { nodes: strings(detail.nodes).join(', ') } }
    case 'socle_rules': {
      if (check.status === 'pass') return { key: detail.node_firewalls === 'off' ? 'checks.socle_rules.nodesOff' : 'checks.socle_rules.pass' }
      return socleMessage(detail)
    }
    case 'node_traffic':
      return trafficMessage(check, detail)
    case 'log_ratelimit': {
      const rate = text(detail.rate)
      if (check.status === 'warn') return { key: 'checks.log_ratelimit.default', values: { rate } }
      return rate ? { key: 'checks.log_ratelimit.pass', values: { rate } } : { key: 'checks.log_ratelimit.disabled' }
    }
    case 'self_in_zone':
      if (check.status === 'warn' && typeof detail.unchecked === 'number') {
        const key = detail.reason === 'collect_cap' ? 'checks.self_in_zone.uncheckedCap' : 'checks.self_in_zone.uncheckedTimeout'
        return { key, values: { count: detail.unchecked } }
      }
      if (check.status === 'warn' && detail.reason === 'docker_internal') return { key: 'checks.self_in_zone.dockerInternal', values: { self_ip: text(detail.self_ip) } }
      if (check.status === 'warn' && detail.egress === true) return { key: 'checks.self_in_zone.inZoneEgress', values: { zone: text(detail.zone), self_ip: text(detail.self_ip) } }
      if (check.status === 'warn') return { key: 'checks.self_in_zone.inZone', values: { zone: text(detail.zone), self_ip: text(detail.self_ip) } }
      return { key: detail.self_ip === 'unknown' ? 'checks.self_in_zone.unknown' : 'checks.self_in_zone.pass' }
    case 'egress_subnets': {
      if (check.status === 'pass') return { key: 'checks.egress_subnets.pass' }
      const guests = Array.isArray(detail.guests) ? detail.guests : []
      return { key: 'checks.egress_subnets.warn', values: { count: guests.length, guests: guestList(guests) } }
    }
    case 'ip_filter':
      return ipFilterMessage(check, detail)
    default:
      return null
  }
}

/**
 * What a SOCLE_MISSING refusal says beyond its fixed message, from the failed
 * check it carries, as keys under microsegPilot: for the socle check, the
 * Docker reason, the security group that could not be read and the addresses
 * the rules leave out; for the node traffic check, the networks cut.
 */
export function socleRefusalLines(detail: Record<string, unknown> | undefined): Array<{ key: string; values?: Record<string, string> }> {
  if (!detail) return []
  if (isTrafficRefusal(detail)) {
    // Short sentences, one per line of the refusal: what to do, then each network cut and its nodes.
    const cut = trafficLines(detail, 'blocked').map(line => ({ key: `preflight.${line.key.replace('.cut.', '.short.')}`, values: { network: line.values?.network ?? '', nodes: line.values?.nodes ?? '' } }))
    return [{ key: 'preflight.checks.node_traffic.fixShort' }, ...cut]
  }
  const { reasons } = socleLines(detail, '')
  const lines: Array<{ key: string; values?: Record<string, string> }> = reasons.map(r => (r.key === 'checks.socle_rules.dockerInternal'
    ? { key: 'preflight.checks.self_in_zone.dockerInternal' }
    : { key: `preflight.${r.key}`, values: r.values }))
  const ips = strings(detail.uncovered)
  const nodes = strings(detail.uncovered_nodes)
  if (ips.length > 0 && nodes.length > 0) lines.push({ key: 'stop.socleUncoveredNodes', values: { ips: ips.join(', '), nodes: nodes.join(', ') } })
  else if (ips.length > 0) lines.push({ key: 'stop.socleUncovered', values: { ips: ips.join(', ') } })
  return lines
}

/** "... on connection <id>: ...": the cluster a SOCLE_MISSING refusal of a shared policy names. */
const SOCLE_CLUSTER_RE = /\bon connection ([^\s:]+)/

/**
 * The connection a refused lift names when the policy has several clusters, null otherwise. The text itself is never
 * shown: the caller names the cluster as the user knows it, or in general words when it is outside their scope.
 */
export function socleRefusalCluster(message: string | null | undefined): string | null {
  return SOCLE_CLUSTER_RE.exec(message ?? '')?.[1] ?? null
}

export type RateUnit = 'second' | 'minute' | 'hour' | 'day'

const RATE_RE = /^\s*(\d+)\s*\/\s*(second|minute|hour|day)\s*$/

/** A PVE log rate ("20/second") split into its count and unit, to be said in the user's language; null when PVE wrote something else. */
export function parseRate(raw: string | undefined): { count: number; unit: RateUnit } | null {
  const m = RATE_RE.exec(raw ?? '')
  return m ? { count: Number(m[1]), unit: m[2] as RateUnit } : null
}

const KNOWN_IDS = new Set(['cluster_firewall', 'firewall_service', 'socle_rules', 'node_traffic', 'log_ratelimit', 'self_in_zone', 'egress_subnets', 'ip_filter'])

export function preflightMessage(check: PreflightCheck): PreflightMessage {
  const found = detailOf(check)
  if (!found) return { title: KNOWN_IDS.has(check.id) ? check.id : null, detail: null }
  const { more, joiner, ...detail } = found
  return { title: KNOWN_IDS.has(check.id) ? check.id : null, detail, ...(more ? { more } : {}), ...(joiner ? { joiner } : {}) }
}

/** The IP filter check has nothing per member to show yet: no check has run, or the cluster is not deployed. */
export function ipFilterNotComputed(check: PreflightCheck): boolean {
  return check.detail?.reason === 'not_checked' || check.detail?.reason === 'not_deployed'
}

/** The cluster firewall is off because the emergency stop switched it off: lifting the stop is the fix, not the wizard. */
export function heldByStop(check: PreflightCheck): boolean {
  return check.id === 'cluster_firewall' && check.status !== 'pass'
    && check.detail?.held_by_stop === true
}

/** What the checks of a cluster say about whether its firewall filters at all (the two findings the plan and the association show). */
export type FirewallFindings = {
  /** The cluster firewall is off and the emergency stop does not explain it: nothing is filtered on this cluster. */
  off: boolean
  /** The nodes where the firewall service is stopped (nothing is filtered on them). */
  serviceNodes: string[]
}

/** Both findings of a cluster's checks; none for checks that could not be read (nothing is claimed then). */
export function firewallFindings(checks: readonly PreflightCheck[] | undefined): FirewallFindings {
  const clusterFirewall = checks?.find(c => c.id === 'cluster_firewall')
  const service = checks?.find(c => c.id === 'firewall_service')
  return {
    off: !!clusterFirewall && clusterFirewall.status === 'fail' && !heldByStop(clusterFirewall) && !text(clusterFirewall.detail?.error),
    serviceNodes: service?.status === 'fail' && !text(service.detail?.error) ? strings(service.detail?.nodes) : [],
  }
}

/** "... on connection a,b: ...": the connections a refused apply names, when the answer carries no `connections` list. */
const FIREWALL_OFF_RE = /\bon connections? ([^\s:]+)/

/** The clusters whose firewall is off, from a CLUSTER_FIREWALL_OFF refusal: its `connections`, else the IDs of its text. */
export function firewallOffClusters(connections: readonly string[] | undefined, message: string | undefined): string[] {
  if (connections && connections.length > 0) return [...connections]
  return (FIREWALL_OFF_RE.exec(message ?? '')?.[1] ?? '').split(',').filter(Boolean)
}

/** A failed apply run of a cluster whose firewall was switched off meanwhile: its error starts with this text. */
export function isFirewallOffRunError(error: string | undefined | null): boolean {
  return /^cluster firewall disabled/i.test(error ?? '')
}

/** Both fixes the orchestrator names are done by the deployment wizard (it enables the cluster firewall last). */
export function opensWizard(check: PreflightCheck): boolean {
  return check.status !== 'pass' && !heldByStop(check) && check.fix === 'enable_cluster_firewall'
}

/** What the pre-flight button sets: 20 log lines a second per node, bursts of 50, measured on the lab while observing. */
export const RECOMMENDED_OBSERVE_LOG_RATE = 'enable=1,rate=20/second,burst=50'

/**
 * The rate the engine will raise PVE's log to while a zone is observed, when the log rate check warns and the settings
 * hold one: the `rate` of `observe_log_rate_limit` ("20/second"). Null when the check does not warn or the settings
 * leave the log rate alone (the engine then never touches it).
 */
export function raisesLogRate(check: PreflightCheck, observe: string | undefined): string | null {
  if (check.id !== 'log_ratelimit' || check.status !== 'warn' || !observe) return null
  const parts = new Map(observe.split(',').map(p => p.trim().split('=') as [string, string | undefined]))
  if (parts.get('enable') === '0') return null
  return parts.get('rate') ?? null
}
