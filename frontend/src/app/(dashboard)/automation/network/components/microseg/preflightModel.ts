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

function detailOf(check: PreflightCheck): PreflightMessage['detail'] & { more?: Line[] } | null {
  const detail = check.detail ?? {}
  const error = text(detail.error)
  if (check.status === 'fail' && error) return { key: 'readFailed', values: { error } }

  switch (check.id) {
    case 'cluster_firewall':
      if (heldByStop(check)) return { key: 'checks.cluster_firewall.heldByStop' }
      return { key: check.status === 'pass' ? 'checks.cluster_firewall.pass' : 'checks.cluster_firewall.off' }
    case 'socle_rules': {
      if (check.status === 'pass') return { key: detail.node_firewalls === 'off' ? 'checks.socle_rules.nodesOff' : 'checks.socle_rules.pass' }
      return socleMessage(detail)
    }
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
    default:
      return null
  }
}

/**
 * What a SOCLE_MISSING refusal says beyond its fixed message, from the failed
 * socle check it carries: the Docker reason, the security group that could not
 * be read and the addresses the rules leave out, as keys under microsegPilot.
 */
export function socleRefusalLines(detail: Record<string, unknown> | undefined): Array<{ key: string; values?: Record<string, string> }> {
  if (!detail) return []
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

export type RateUnit = 'second' | 'minute' | 'hour' | 'day'

const RATE_RE = /^\s*(\d+)\s*\/\s*(second|minute|hour|day)\s*$/

/** A PVE log rate ("20/second") split into its count and unit, to be said in the user's language; null when PVE wrote something else. */
export function parseRate(raw: string | undefined): { count: number; unit: RateUnit } | null {
  const m = RATE_RE.exec(raw ?? '')
  return m ? { count: Number(m[1]), unit: m[2] as RateUnit } : null
}

const KNOWN_IDS = new Set(['cluster_firewall', 'socle_rules', 'log_ratelimit', 'self_in_zone', 'egress_subnets'])

export function preflightMessage(check: PreflightCheck): PreflightMessage {
  const found = detailOf(check)
  if (!found) return { title: KNOWN_IDS.has(check.id) ? check.id : null, detail: null }
  const { more, ...detail } = found
  return { title: KNOWN_IDS.has(check.id) ? check.id : null, detail, ...(more ? { more } : {}) }
}

/** The cluster firewall is off because the emergency stop switched it off: lifting the stop is the fix, not the wizard. */
export function heldByStop(check: PreflightCheck): boolean {
  return check.id === 'cluster_firewall' && check.status !== 'pass'
    && check.detail?.held_by_stop === true
}

/** Both fixes the orchestrator names are done by the deployment wizard (it enables the cluster firewall last). */
export function opensWizard(check: PreflightCheck): boolean {
  return check.status !== 'pass' && !heldByStop(check) && (check.fix === 'socle' || check.fix === 'enable_cluster_firewall')
}
