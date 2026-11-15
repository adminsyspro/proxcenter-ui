import { describe, expect, it } from 'vitest'

import type { PlanStep } from '@/lib/microseg/types'

import { groupPlanSteps } from './planGroups'

const step = (index: number, kind: string, guest?: PlanStep['guest']): PlanStep => ({ index, kind, object: `o${index}`, guest, summary: `s${index}` })
const g1 = { node: 'pve1', type: 'qemu' as const, vmid: 101 }
const g2 = { node: 'pve2', type: 'lxc' as const, vmid: 200 }

describe('groupPlanSteps', () => {
  it('groups cluster steps first then one group per guest', () => {
    const steps = [step(0, 'ipset.create'), step(1, 'guest.tags', g1), step(2, 'group.create'), step(3, 'guest.nic', g2), step(4, 'guest.group', g1)]
    const grouped = groupPlanSteps(steps)

    expect(grouped.cluster.map(s => s.index)).toEqual([0, 2])
    expect(grouped.byGuest.map(g => g.guest)).toEqual([g1, g2])
    expect(grouped.byGuest[0].steps.map(s => s.index)).toEqual([1, 4])
    expect(grouped.byGuest[1].steps.map(s => s.index)).toEqual([3])
  })

  it('keeps the plan order inside each group and tells apart the same vmid on two nodes or types', () => {
    const a = { node: 'pve1', type: 'qemu' as const, vmid: 100 }
    const b = { node: 'pve2', type: 'qemu' as const, vmid: 100 }
    const c = { node: 'pve1', type: 'lxc' as const, vmid: 100 }
    const grouped = groupPlanSteps([step(0, 'guest.tags', b), step(1, 'guest.tags', a), step(2, 'guest.tags', c), step(3, 'guest.nic', b)])
    expect(grouped.byGuest.map(g => g.guest)).toEqual([b, a, c])
    expect(grouped.byGuest[0].steps.map(s => s.index)).toEqual([0, 3])
  })

  it('answers empty groups for an empty plan', () => {
    expect(groupPlanSteps([])).toEqual({ cluster: [], byGuest: [] })
  })
})
