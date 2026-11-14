/** An inbound policy that denies what no rule lets in: DROP, or REJECT (which answers the refusal). */
export const deniesInbound = (policy: string) => policy === 'DROP' || policy === 'REJECT'

export type TodoKind = 'stopHeld' | 'firewallOff' | 'policyIn' | 'unprotected' | 'unzoned' | 'pendingFlows'

/** One line of the "To do" list: what to act on, with its figure when it has one. */
export type TodoItem = { kind: TodoKind; count?: number; more?: boolean }

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
  unprotected: number | null
  unzoned: number | null
  pendingFlows: { count: number; more: boolean } | null
}): TodoItem[] {
  const items: TodoItem[] = []

  if (input.stopHoldsFirewall) items.push({ kind: 'stopHeld' })
  else if (!input.firewallOn && !input.stopped) items.push({ kind: 'firewallOff' })
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
