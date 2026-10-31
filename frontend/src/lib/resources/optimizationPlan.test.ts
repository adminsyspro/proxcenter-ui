import { describe, expect, it } from 'vitest'

import type { ClusterCapacity, NodeCapacity, Thresholds } from './capacity'
import { basicPlan, buildPlanLevers, buildPlanPrompt, sanitizePlanReply, type PlanInput } from './optimizationPlan'

const GiB = 1024 ** 3
const thresholds: Thresholds = { cpu: { warning: 80, critical: 90 }, ram: { warning: 80, critical: 90 }, storage: { warning: 80, critical: 90 } }

function node(name: string, overrides: Partial<NodeCapacity> = {}): NodeCapacity {
  return {
    key: `prod:${name}`, connectionId: 'prod', connectionName: 'PVE-PROD', node: name, online: true,
    cores: 16, cpuPct: 10, memTotal: 64 * GiB, memUsed: 32 * GiB, ramPct: 50,
    vcpuAllocated: 32, ramAllocated: 40 * GiB, guestsRunning: 5, guestsTotal: 6,
    ...overrides,
  }
}

function cluster(overrides: Partial<ClusterCapacity> = {}): ClusterCapacity {
  return {
    id: 'prod', name: 'PVE-PROD', nodesOnline: 3, nodesTotal: 3,
    cpu: { cores: 48, usedPct: 10, vcpuAllocated: 96, ratio: 2 },
    ram: { total: 192 * GiB, used: 96 * GiB, usedPct: 50, allocated: 120 * GiB, ratio: 0.6 },
    storage: { used: 1, total: 2, pct: 50 },
    guests: { running: 15, stopped: 3, templates: 0 },
    nPlusOne: { applicable: true, largestNode: 'pve1', cpuPctAfter: 15, ramPctAfter: 75, ok: true },
    imbalance: { cpu: 2, ram: 24 },
    trends: [],
    ...overrides,
  }
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    overprovisioning: {
      cpu: { efficiency: 12.34 },
      ram: { efficiency: 48.1 },
      topOverprovisioned: [
        { id: 'prod:qemu:pve1:101', name: 'web-01', node: 'pve1', connName: 'PVE-PROD', cpuAllocated: 8, cpuUsedPct: 5, ramAllocatedGB: 16, ramUsedPct: 20, recommendedCpu: 1, recommendedRamGB: 4, potentialSavings: { cpu: 7, ramGB: 12 } },
        { id: 'prod:qemu:pve2:102', name: 'db-01', node: 'pve2', connName: 'PVE-PROD', cpuAllocated: 4, cpuUsedPct: 10, ramAllocatedGB: 8, ramUsedPct: 90, recommendedCpu: 1, recommendedRamGB: 9, potentialSavings: { cpu: 3, ramGB: 0 } },
      ],
    },
    stopped: { count: 3, vcpu: 10, ramBytes: 80 * GiB, diskBytes: 0 },
    largestStopped: [{ id: 'prod:qemu:pve3:200', name: 'old-erp', node: 'pve3', connName: 'PVE-PROD', vcpu: 4, ramBytes: 48 * GiB }],
    clusters: [cluster()],
    nodes: [node('pve1', { ramPct: 85 }), node('pve2', { ramPct: 40 }), node('pve3', { ramPct: 30, vcpuAllocated: 80 })],
    thresholds,
    ...overrides,
  }
}

describe('buildPlanLevers', () => {
  it('turns the overview into levers with their figures and the guests or nodes they concern', () => {
    const levers = buildPlanLevers(input())
    const kind = (k: string) => levers.find(l => l.kind === k)!

    expect(levers.map(l => l.ref)).toEqual(levers.map((_, i) => `l${i + 1}`))
    expect(kind('rightsize')).toMatchObject({ gain: { vcpu: 10, ramBytes: 12 * GiB }, facts: { count: 2, cpuEfficiency: 12.3 }, rulePriority: 'medium' })
    expect(kind('rightsize').details[0]).toMatchObject({ type: 'guest', id: 'prod:qemu:pve1:101', targetVcpu: 1, targetRamBytes: 4 * GiB })
    // db-01 is busy on RAM: the sizing rule says 9 GB, the plan keeps its 8 GB.
    expect(kind('rightsize').details[1]).toMatchObject({ targetVcpu: 1, targetRamBytes: 8 * GiB })
    expect(kind('dormant')).toMatchObject({ gain: { vcpu: 10, ramBytes: 80 * GiB }, rulePriority: 'medium' })
    expect(kind('rebalance')).toMatchObject({ cluster: 'PVE-PROD', facts: { top: 'pve1', topPct: 85, bottom: 'pve3', bottomPct: 30 }, rulePriority: 'high' })
    expect(kind('overcommit')).toMatchObject({ facts: { count: 1, worst: 'pve3', worstRatio: 5 }, rulePriority: 'low' })
  })

  it('puts the high-priority levers first and leaves out what does not apply', () => {
    const levers = buildPlanLevers(input({
      overprovisioning: null,
      stopped: { count: 0, vcpu: 0, ramBytes: 0, diskBytes: 0 },
      clusters: [cluster({ imbalance: { cpu: 1, ram: 5 } })],
      nodes: [node('pve1')],
    }))

    expect(levers).toEqual([])
    expect(buildPlanLevers(input())[0].rulePriority).toBe('high')
  })
})

describe('buildPlanPrompt', () => {
  it('lists every lever by ref with the names and figures the model may quote', () => {
    const prompt = buildPlanPrompt('all clusters', buildPlanLevers(input()), 'LANGUAGE: French')

    expect(prompt).toContain('VM "web-01" on pve1: 8 vCPU at 5% CPU -> 1 vCPU; 16 GiB at 20% RAM -> 4 GiB')
    expect(prompt).toContain('VM "db-01" on pve2: 4 vCPU at 10% CPU -> 1 vCPU; 8 GiB at 90% RAM -> 8 GiB')
    expect(prompt).toContain('"old-erp" on pve3 (PVE-PROD): 4 vCPU, 48 GiB RAM')
    expect(prompt).toContain('busiest pve1 at 85%, least busy pve3 at 30%')
    expect(prompt.trim().endsWith('LANGUAGE: French')).toBe(true)
  })
})

describe('sanitizePlanReply', () => {
  it('keeps the model ranking and text, and every lever it left out with rule text after', () => {
    const levers = buildPlanLevers(input())
    const dormant = levers.find(l => l.kind === 'dormant')!
    const plan = sanitizePlanReply({
      summary: 'Commencer par les invités arrêtés.',
      plan: [
        { ref: dormant.ref, priority: 'high', explanation: '80 Go dorment.', action: 'Archiver old-erp.' },
        { ref: 'l99', priority: 'high', explanation: 'inventé', action: 'x' },
        { ref: dormant.ref, priority: 'low', explanation: 'doublon', action: 'x' },
      ],
    }, levers)!

    expect(plan.summary).toBe('Commencer par les invités arrêtés.')
    expect(plan.items[0]).toMatchObject({ kind: 'dormant', priority: 'high', explanation: '80 Go dorment.', gain: { ramBytes: 80 * GiB } })
    expect(plan.items).toHaveLength(levers.length)
    expect(plan.items.slice(1).every(i => i.explanationKey === `explain.${i.kind}`)).toBe(true)
  })

  it('keeps the computed direction of a rebalance whatever the model writes', () => {
    const levers = buildPlanLevers(input())
    const rebalance = levers.find(l => l.kind === 'rebalance')!
    const plan = sanitizePlanReply({ summary: 's', plan: [{ ref: rebalance.ref, priority: 'medium', explanation: 'pve1 est chargé.', action: 'Migrer vers pve1.' }] }, levers)!

    expect(plan.items[0]).toMatchObject({ explanation: 'pve1 est chargé.', action: '', actionKey: 'action.rebalance' })
  })

  it('falls back to the lever priority when the model gives none it knows', () => {
    const levers = buildPlanLevers(input())
    const plan = sanitizePlanReply({ summary: 's', plan: [{ ref: 'l1', priority: 'urgent', explanation: 'e', action: 'a' }] }, levers)!

    expect(plan.items[0].priority).toBe(levers[0].rulePriority)
  })

  it('gives up on a reply with nothing usable', () => {
    const levers = buildPlanLevers(input())

    expect(sanitizePlanReply(null, levers)).toBeNull()
    expect(sanitizePlanReply({ summary: '', plan: [{ ref: 'zz', explanation: 'x' }] }, levers)).toBeNull()
  })
})

describe('basicPlan', () => {
  it('sums what the levers free in its summary', () => {
    const plan = basicPlan(buildPlanLevers(input()))

    expect(plan.summaryKey).toBe('summary')
    expect(plan.summaryParams).toEqual({ count: 4, vcpu: 20, ram: 92 })
    expect(plan.items.every(i => i.actionKey === `action.${i.kind}`)).toBe(true)
  })

  it('says so when there is nothing to optimise', () => {
    expect(basicPlan([])).toEqual({ summary: '', summaryKey: 'summaryNone', items: [] })
  })
})
