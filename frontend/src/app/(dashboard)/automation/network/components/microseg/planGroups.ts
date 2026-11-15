import type { GuestRef, PlanStep } from '@/lib/microseg/types'

import type { PolicyGuest } from './zoneModel'

export type GuestGroup = { guest: GuestRef; steps: PlanStep[] }

export type PlanGroups = {
  /** Steps on objects of the cluster (ipsets, security groups, rate limit): no guest. */
  cluster: PlanStep[]
  /** One group per guest, in the order the guest first appears in the plan. */
  byGuest: GuestGroup[]
}

export const guestKey = (g: GuestRef) => `${g.node}/${g.type}/${g.vmid}`

/** Cluster steps first, then one group per guest; the plan order is kept inside each group. */
export function groupPlanSteps(steps: PlanStep[]): PlanGroups {
  const cluster: PlanStep[] = []
  const byKey = new Map<string, GuestGroup>()
  for (const step of steps) {
    if (!step.guest) {
      cluster.push(step)
      continue
    }
    const key = guestKey(step.guest)
    const group = byKey.get(key)
    if (group) group.steps.push(step)
    else byKey.set(key, { guest: step.guest, steps: [step] })
  }
  return { cluster, byGuest: [...byKey.values()] }
}

/** Looks a guest of a run up in the inventory list; undefined when it is not listed. */
export function findGuest(guests: PolicyGuest[], ref: GuestRef): PolicyGuest | undefined {
  return guests.find(g => g.vmid === ref.vmid && g.node === ref.node && g.type === ref.type)
}

/** The name of a guest, or `type/vmid` when the inventory does not list it. */
export function guestName(guests: PolicyGuest[], ref: GuestRef): string {
  return findGuest(guests, ref)?.name ?? `${ref.type}/${ref.vmid}`
}
