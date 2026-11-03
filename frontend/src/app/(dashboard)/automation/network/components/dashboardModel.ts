import type { FirewallCoverage } from '@/hooks/useZeroTrust'
import type { FirewallRule, SecurityGroup } from '@/lib/api/firewall'

export type CoverageFigures = Pick<FirewallCoverage, 'enabled' | 'disabled' | 'unknown' | 'measured' | 'total'>

/** Share of the guests told apart that are filtered; null when none could be told. Unknown guests are left out. */
export function coveragePercent(c: CoverageFigures | null | undefined): number | null {
  if (!c) return null
  const known = c.enabled + c.disabled

  return known > 0 ? (c.enabled / known) * 100 : null
}

/**
 * The guest figures of the Dashboard, one source for every card (UA46): the total is the inventory's (templates
 * left out), running and stopped come from the same guest list, and "protected" is what Proxmox applies: firewall on
 * in the guest options AND on a NIC. `running`/`stopped` are null on an answer without guest rows.
 */
export type GuestTotals = {
  total: number
  running: number | null
  stopped: number | null
  protected: number
  unprotected: number
  /** Could not be told (offline node, slow Proxmox): normally 0. */
  unknown: number
  /** Guests looked at: all of them, or the sample above 200. */
  measured: number
  sampled: boolean
}

export function guestTotals(c: FirewallCoverage | null | undefined): GuestTotals | null {
  if (!c) return null
  const rows = c.guests
  const running = rows ? rows.filter(r => r.status === 'running').length : null
  const stopped = rows ? rows.filter(r => r.status === 'stopped').length : null

  return {
    total: c.total,
    running,
    stopped,
    protected: c.enabled,
    unprotected: c.disabled,
    unknown: c.unknown,
    measured: c.measured,
    sampled: c.sampled,
  }
}

/** An inbound policy that denies what no rule lets in: DROP, or REJECT (which answers the refusal). */
export const deniesInbound = (policy: string) => policy === 'DROP' || policy === 'REJECT'

export const SCORE_WEIGHTS = { firewall: 30, policyIn: 25, coverage: 45 } as const

export type ScoreComponentKey = keyof typeof SCORE_WEIGHTS

/** One part of the Zero Trust score: its points out of its weight, null while it cannot be told. */
export type ScoreComponent = { key: ScoreComponentKey; weight: number; points: number | null }

export type ZeroTrustScore = {
  components: ScoreComponent[]
  /** Null until every component is in: a total made of part of them would read as a verdict. */
  total: number | null
  coveragePercent: number | null
}

/** All of the weight when the condition holds, none when it does not, null while it is not known. */
function pointsIf(condition: boolean | null, weight: number): number | null {
  if (condition === null) return null

  return condition ? weight : 0
}

/**
 * Cluster firewall on: 30. Inbound policy DROP or REJECT: 25. Guest coverage: 45 x the share of protected guests among those
 * told apart. Each input is null while it is not known.
 */
export function zeroTrustScore(input: { firewallOn: boolean | null; policyIn: string | null; coverage: CoverageFigures | null }): ZeroTrustScore {
  const percent = coveragePercent(input.coverage)
  const strict = input.policyIn === null ? null : deniesInbound(input.policyIn)
  const components: ScoreComponent[] = [
    { key: 'firewall', weight: SCORE_WEIGHTS.firewall, points: pointsIf(input.firewallOn, SCORE_WEIGHTS.firewall) },
    { key: 'policyIn', weight: SCORE_WEIGHTS.policyIn, points: pointsIf(strict, SCORE_WEIGHTS.policyIn) },
    { key: 'coverage', weight: SCORE_WEIGHTS.coverage, points: percent === null ? null : Math.round((percent * SCORE_WEIGHTS.coverage) / 100) },
  ]
  const complete = components.every(c => c.points !== null)

  return { components, total: complete ? components.reduce((sum, c) => sum + (c.points ?? 0), 0) : null, coveragePercent: percent }
}

export type ScoreBand = 'good' | 'fair' | 'poor'

export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'good'

  return score >= 50 ? 'fair' : 'poor'
}

/** The ports the deployment wizard opens for the administration of the cluster: web UI / API and SSH. */
export const MANAGEMENT_PORTS = [8006, 22] as const

/** A `dport` of Proxmox ("22", "22,8006", "60000:60050") holds this port. */
function dportHolds(dport: string, port: number): boolean {
  return dport.split(',').some(part => {
    const [from, to = from] = part.trim().split(':').map(Number)
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false

    return port >= from && port <= to
  })
}

const MACRO_PORTS: Record<string, number> = { SSH: 22 }

/** An enabled inbound ACCEPT rule that lets TCP traffic to this port in. */
function acceptsPort(rule: FirewallRule, port: number): boolean {
  if (rule.enable === 0 || rule.type !== 'in' || rule.action !== 'ACCEPT') return false
  if (rule.macro) return MACRO_PORTS[rule.macro] === port
  if (rule.proto && rule.proto !== 'tcp') return false

  return !rule.dport || dportHolds(rule.dport, port)
}

/**
 * The administration ports no cluster rule lets in: a rule of the cluster itself, or of an enabled security group it
 * references. Empty when the web UI and SSH are both covered.
 */
export function missingManagementPorts(rules: FirewallRule[], groups: SecurityGroup[]): number[] {
  const effective: FirewallRule[] = []
  for (const rule of rules) {
    if (rule.type === 'group') {
      if (rule.enable === 0) continue
      effective.push(...(groups.find(g => g.group === rule.action)?.rules ?? []))
    } else {
      effective.push(rule)
    }
  }

  return MANAGEMENT_PORTS.filter(port => !effective.some(rule => acceptsPort(rule, port)))
}

export type TodoKind = 'stopHeld' | 'firewallOff' | 'managementRules' | 'policyIn' | 'unprotected' | 'unzoned' | 'pendingFlows'

/** One line of the "To do" list: what to act on, with its figure when it has one. */
export type TodoItem = { kind: TodoKind; count?: number; more?: boolean; ports?: number[] }

/**
 * The "To do" list, most urgent first. During an emergency stop the cluster firewall is never offered back through
 * the deployment wizard (that would undo the stop): the only way back is Resume. Null inputs are not known and add
 * no line.
 */
export function todoItems(input: {
  firewallOn: boolean
  stopped: boolean
  stopHoldsFirewall: boolean
  policyIn: string
  missingManagement: number[]
  unprotected: number | null
  unzoned: number | null
  pendingFlows: { count: number; more: boolean } | null
}): TodoItem[] {
  const items: TodoItem[] = []

  if (input.stopHoldsFirewall) items.push({ kind: 'stopHeld' })
  else if (!input.firewallOn && !input.stopped) items.push({ kind: 'firewallOff' })
  if (input.firewallOn && !input.stopped && input.missingManagement.length > 0) items.push({ kind: 'managementRules', ports: input.missingManagement })
  if (!deniesInbound(input.policyIn)) items.push({ kind: 'policyIn' })
  if (input.unprotected) items.push({ kind: 'unprotected', count: input.unprotected })
  if (input.unzoned) items.push({ kind: 'unzoned', count: input.unzoned })
  if (input.pendingFlows?.count) items.push({ kind: 'pendingFlows', count: input.pendingFlows.count, more: input.pendingFlows.more })

  return items
}

/** What a block of the Dashboard shows: a skeleton, its figures, or that they could not be read. */
export type BlockPhase = 'loading' | 'ready' | 'unavailable'

export type DashboardPhase = { cluster: BlockPhase; coverage: BlockPhase; score: BlockPhase; todo: BlockPhase }

/**
 * One neutral skeleton per block while its figures are not in, never a figure made of empty data. The score waits
 * for the firewall data and the coverage, and is "not computed" when one of them failed. The "To do" list also waits
 * for the emergency stop state (it may be what holds the firewall off) and the micro-segmentation lists, so no line
 * pops in after "Nothing to do"; it is not available when the firewall data failed.
 */
export function dashboardPhase(input: {
  firewallLoading: boolean
  loadError: boolean
  coverageIn: boolean
  coverageFailed: boolean
  stopStateIn: boolean
  microsegListsIn: boolean
}): DashboardPhase {
  let cluster: BlockPhase = 'ready'
  if (input.loadError) cluster = 'unavailable'
  else if (input.firewallLoading) cluster = 'loading'

  let coverage: BlockPhase = 'loading'
  if (input.coverageIn) coverage = 'ready'
  else if (input.coverageFailed) coverage = 'unavailable'

  let score: BlockPhase = 'ready'
  if (cluster === 'unavailable' || coverage === 'unavailable') score = 'unavailable'
  else if (cluster === 'loading' || coverage === 'loading') score = 'loading'

  let todo: BlockPhase = 'ready'
  if (cluster === 'unavailable') todo = 'unavailable'
  else if (cluster === 'loading' || coverage === 'loading' || !input.stopStateIn || !input.microsegListsIn) todo = 'loading'

  return { cluster, coverage, score, todo }
}
