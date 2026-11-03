import type { FirewallRule, SecurityGroup } from '@/lib/api/firewall'

/** An inbound policy that denies what no rule lets in: DROP, or REJECT (which answers the refusal). */
export const deniesInbound = (policy: string) => policy === 'DROP' || policy === 'REJECT'

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

export type DashboardPhase = { cluster: BlockPhase; coverage: BlockPhase; todo: BlockPhase }

/**
 * One neutral skeleton per block while its figures are not in, never a figure made of empty data. The "To do" list
 * waits for the firewall data, the coverage, the emergency stop state (it may be what holds the firewall off) and
 * the micro-segmentation lists, so no line pops in after "Nothing to do"; it is not available when the firewall data
 * failed.
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

  let todo: BlockPhase = 'ready'
  if (cluster === 'unavailable') todo = 'unavailable'
  else if (cluster === 'loading' || coverage === 'loading' || !input.stopStateIn || !input.microsegListsIn) todo = 'loading'

  return { cluster, coverage, todo }
}
