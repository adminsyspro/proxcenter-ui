/**
 * `rank_guest_hardware` ranks by assigned sizing or by live usage (#459).
 *
 * The usage metrics exist because llama3.1:8b, asked which VM uses the most
 * CPU right now, kept calling this tool with metric="cpu": rejecting the value
 * made it retry, accepting a usage metric makes the call succeed with the
 * right figure.
 */

import { describe, it, expect } from 'vitest'

import type { AiGuest, AiSnapshot } from '@/lib/ai/context'
import { rankGuestHardwareTool } from './guests'
import { ToolArgumentError, type AiToolContext } from './types'

function guest(o: Partial<AiGuest> & { name: string; vmid: string }): AiGuest {
  return {
    connId: 'conn-1', cluster: 'prod', type: 'VM', kind: 'qemu', status: 'running', node: 'pve1',
    cpuPct: 5, memPct: 40, memUsedGb: 2, memTotalGb: 4, vcpus: 2, diskTotalGb: 32, template: false,
    ...o,
  }
}

const guests = [
  guest({ name: 'db-01', vmid: '101', cpuPct: 81.2, memPct: 88.5, memTotalGb: 32, vcpus: 8 }),
  guest({ name: 'build-runner-03', vmid: '214', cpuPct: 1.9, memPct: 12, memTotalGb: 16, vcpus: 16 }),
  guest({ name: 'sap-hana-01', vmid: '220', cpuPct: 4.2, memPct: 23, memTotalGb: 128, vcpus: 12 }),
  guest({ name: 'idle-01', vmid: '150', status: 'stopped', cpuPct: 0, memPct: 0, memTotalGb: 8, vcpus: 4 }),
  guest({ name: 'tpl', vmid: '900', template: true, cpuPct: 99, memPct: 99, vcpus: 64 }),
]

const snapshot: AiSnapshot = {
  clusters: [{ id: 'conn-1', name: 'prod', nodeCount: 1, guestCount: guests.length }],
  nodes: [],
  guests,
  summary: { totalGuests: 5, runningGuests: 3, stoppedGuests: 2, totalNodes: 1, onlineNodes: 1 },
  cached: false,
}

const ctx: AiToolContext = { snapshot, tenantId: 't1', locale: 'en' }

async function rank(args: Record<string, unknown>) {
  return rankGuestHardwareTool.execute(args, ctx) as Promise<any>
}

describe('rank_guest_hardware', () => {
  it('ranks by assigned vCPUs, most first, templates excluded', async () => {
    const res = await rank({ metric: 'vcpus', limit: 2 })

    expect(res.unit).toBe('vCPU')
    expect(res.ranking.map((r: any) => r.name)).toEqual(['build-runner-03', 'sap-hana-01'])
  })

  it('ranks by live CPU usage, so a load question no longer needs the snapshot top 10', async () => {
    const res = await rank({ metric: 'cpu_usage', limit: 1 })

    expect(res.unit).toBe('%')
    expect(res.ranking[0]).toMatchObject({ name: 'db-01', cpuUsagePct: 81.2 })
  })

  it('keeps a zero usage reading in the ranking rather than dropping it as missing', async () => {
    const res = await rank({ metric: 'memory_usage' })

    expect(res.missingMetric).toBe(0)
    expect(res.ranking.map((r: any) => r.name)).toEqual(['db-01', 'sap-hana-01', 'build-runner-03', 'idle-01'])
  })

  it('carries both the sizing and the usage figures on every entry', async () => {
    const res = await rank({ metric: 'memory', limit: 1 })

    expect(res.ranking[0]).toMatchObject({ name: 'sap-hana-01', memoryGb: 128, memoryUsagePct: 23, cpuUsagePct: 4.2 })
  })

  it('rejects a metric it does not know, naming the accepted ones', async () => {
    await expect(rank({ metric: 'cpu' })).rejects.toThrow(ToolArgumentError)
    await expect(rank({ metric: 'cpu' })).rejects.toThrow('cpu_usage')
  })
})
