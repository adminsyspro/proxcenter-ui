// What a preflight check says, as i18n keys and values. The ids and the detail
// keys are the orchestrator's (internal/microseg/preflight.go); an id this
// version does not know is shown by its id, without a detail.

import type { PreflightCheck } from '@/lib/microseg/types'

export type PreflightMessage = {
  /** Under microsegPilot.preflight.checks, or null for an unknown id (shown as the id). */
  title: string | null
  /** Under microsegPilot.preflight, with its values, or null when the check says nothing more. */
  detail: { key: string; values?: Record<string, string | number> } | null
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

function detailOf(check: PreflightCheck): PreflightMessage['detail'] {
  const detail = check.detail ?? {}
  const error = text(detail.error)
  if (check.status === 'fail' && error) return { key: 'readFailed', values: { error } }

  switch (check.id) {
    case 'cluster_firewall':
      if (heldByStop(check)) return { key: 'checks.cluster_firewall.heldByStop' }
      return { key: check.status === 'pass' ? 'checks.cluster_firewall.pass' : 'checks.cluster_firewall.off' }
    case 'socle_rules': {
      if (check.status === 'pass') return { key: detail.node_firewalls === 'off' ? 'checks.socle_rules.nodesOff' : 'checks.socle_rules.pass' }
      const ports = socleMissing(detail)
      if (detail.reason === 'docker_internal') return { key: 'checks.socle_rules.dockerInternal', values: { ports } }
      const uncovered = (Array.isArray(detail.uncovered) ? detail.uncovered : []).filter((ip): ip is string => typeof ip === 'string')
      if (uncovered.length > 0) return { key: 'checks.socle_rules.missingFor', values: { ports, ips: uncovered.join(', ') } }
      return { key: 'checks.socle_rules.missing', values: { ports } }
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
 * socle check it carries: the Docker reason and the addresses the rules leave
 * out, as keys under microsegPilot.
 */
export function socleRefusalLines(detail: Record<string, unknown> | undefined): Array<{ key: string; values?: Record<string, string> }> {
  if (!detail) return []
  const lines: Array<{ key: string; values?: Record<string, string> }> = []
  if (detail.reason === 'docker_internal') lines.push({ key: 'preflight.checks.self_in_zone.dockerInternal' })
  const uncovered = (Array.isArray(detail.uncovered) ? detail.uncovered : []).filter((ip): ip is string => typeof ip === 'string')
  if (uncovered.length > 0) lines.push({ key: 'stop.socleUncovered', values: { ips: uncovered.join(', ') } })
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
  return { title: KNOWN_IDS.has(check.id) ? check.id : null, detail: detailOf(check) }
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
