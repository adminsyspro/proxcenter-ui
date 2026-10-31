/**
 * Guards the narrow views of `get_ceph_status`.
 *
 * They exist because of two failed recette rounds on qwen2.5:7b against the lab
 * cluster. Asked "are there any Ceph improvements to make?", the model first
 * transcribed all ten sections of the full payload, and then, once the prompt
 * discouraged that, answered that improvements existed without naming a single
 * one. `focus='improvements'` removes the sorting problem by handing over the
 * findings alone, so what these tests hold is that the narrow view stays narrow:
 * the moment capacity, pools or performance leak back into it, the model has
 * something to transcribe again and the regression returns silently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { InventorySnapshot } from '@/lib/tools/snapshot'
import { ToolArgumentError, type ToolContext } from './types'

const pveFetch = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async () => ({ id: 'conn-1', name: 'PVE-CLUSTER', baseUrl: 'https://pve:8006', apiToken: 't' }),
}))

/** The lab cluster of the recette: HEALTH_WARN, clock skew, 2 mons, no standby. */
function labCeph(path: string) {
  if (path.includes('/ceph/status')) {
    return {
      health: {
        status: 'HEALTH_WARN',
        checks: { MON_CLOCK_SKEW: { severity: 'HEALTH_WARN', summary: { message: 'clock skew detected on mon.pve2' } } },
      },
      pgmap: { bytes_total: 161061273600, bytes_used: 17825792000, bytes_avail: 143235481600, num_pgs: 33, pgs_by_state: [{ state_name: 'active+clean', count: 33 }] },
      monmap: { mons: [{ name: 'pve1' }, { name: 'pve2' }] },
      quorum: [0, 1],
      mgrmap: { active_name: 'pve1', standbys: [] },
    }
  }

  if (path.includes('/ceph/osd')) {
    return {
      root: {
        children: [{
          id: -1, name: 'default', type: 'root',
          children: [
            { id: 1, name: 'osd.0', type: 'osd', device_class: 'ssd', status: 'up', in: 1, percent_used: 11, total_space: 53687091200, commit_latency_ms: 2, apply_latency_ms: 2, host: 'pve1' },
            { id: 2, name: 'osd.1', type: 'osd', device_class: 'ssd', status: 'up', in: 1, percent_used: 11, total_space: 53687091200, commit_latency_ms: 3, apply_latency_ms: 3, host: 'pve2' },
            { id: 3, name: 'osd.2', type: 'osd', device_class: 'ssd', status: 'up', in: 1, percent_used: 11, total_space: 53687091200, commit_latency_ms: 2, apply_latency_ms: 2, host: 'pve3' },
          ],
        }],
      },
    }
  }

  if (path.includes('/ceph/pool')) {
    return [
      { pool: 1, pool_name: '.mgr', size: 3, min_size: 2, pg_num: 1, pg_autoscale_mode: 'on', percent_used: 0.001, bytes_used: 1048576 },
      { pool: 2, pool_name: 'CephPool', size: 3, min_size: 2, pg_num: 32, pg_autoscale_mode: 'on', percent_used: 0.1, bytes_used: 17825792000 },
    ]
  }

  return []
}

function ctx(): ToolContext {
  const snapshot: InventorySnapshot = {
    clusters: [{ id: 'conn-1', name: 'PVE-CLUSTER', nodeCount: 3, guestCount: 0 }],
    nodes: ['pve1', 'pve2', 'pve3'].map(name => ({
      connId: 'conn-1', cluster: 'PVE-CLUSTER', name, status: 'online',
      cpuPct: 5, memPct: 30, memUsedGb: 10, memTotalGb: 32,
    })),
    guests: [],
    summary: { totalGuests: 0, runningGuests: 0, stoppedGuests: 0, totalNodes: 3, onlineNodes: 3 },
    cached: false,
  }

  return { snapshot, tenantId: 'tenant-1', locale: 'fr' }
}

async function run(args: Record<string, unknown>) {
  const { getCephStatusTool } = await import('./ceph')

  return getCephStatusTool.execute(args, ctx()) as Promise<any>
}

beforeEach(() => {
  pveFetch.mockReset().mockImplementation(async (_conn: unknown, path: string) => labCeph(path))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe("focus='improvements'", () => {
  it('returns the findings and nothing the model could transcribe instead', async () => {
    const res = await run({ focus: 'improvements' })

    expect(res.findings.length).toBeGreaterThan(0)
    expect(res.findingCount).toBe(res.findings.length)
    expect(res.allClear).toBe(false)
    expect(res.healthStatus).toBe('HEALTH_WARN')

    // The whole point of the narrow view: none of the bulky sections may come
    // back, or the model has material to dump again.
    expect(res.capacity).toBeUndefined()
    expect(res.pools).toBeUndefined()
    expect(res.performance).toBeUndefined()
    expect(res.pgs).toBeUndefined()
    expect(res.observations).toBeUndefined()
    expect(res.osds).toBeUndefined()
  })

  it('names the two findings the lab cluster actually has', async () => {
    const res = await run({ focus: 'improvements' })
    const joined = res.findings.join(' | ')

    // Two monitors is an even count with no loss tolerance, and the single
    // manager has no standby. Both were visible in the recette screenshot and
    // both were absent from the model's answer.
    expect(joined).toMatch(/even number|2 monitors/i)
    expect(joined).toMatch(/standby/i)
  })

  it('carries a measured value in every finding it derives, so the model can quote one', async () => {
    const res = await run({ focus: 'improvements' })

    // Health checks quote Ceph's own message, which need not hold a number.
    for (const finding of res.findings.filter((f: string) => !f.startsWith('Ceph check '))) {
      expect(finding).toMatch(/\d/)
    }
  })

  it('names every health check with its severity and Ceph\'s own message', async () => {
    // Counting the checks alone made llama3.1:8b invent four problems for the
    // lab's HEALTH_ERR.
    const res = await run({ focus: 'improvements' })

    expect(res.findings).toContain('Ceph check MON_CLOCK_SKEW (HEALTH_WARN): clock skew detected on mon.pve2.')
  })

  it('caps the listed health checks and names the rest', async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      const data: any = labCeph(path)

      if (path.includes('/ceph/status')) {
        data.health = {
          status: 'HEALTH_ERR',
          checks: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`CHECK_${i}`, { severity: 'HEALTH_WARN', summary: { message: `problem ${i}` } }])),
        }
      }

      return data
    })

    const res = await run({ focus: 'improvements' })
    const checks = res.findings.filter((f: string) => f.startsWith('Ceph check '))

    expect(checks).toHaveLength(8)
    expect(res.findings).toContain('2 more Ceph check(s) not listed: CHECK_8, CHECK_9.')
  })

  it('states an all-clear explicitly rather than leaving an empty array to interpret', async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      const data: any = labCeph(path)

      if (path.includes('/ceph/status')) {
        data.health = { status: 'HEALTH_OK', checks: {} }
        data.monmap = { mons: [{ name: 'pve1' }, { name: 'pve2' }, { name: 'pve3' }] }
        data.quorum = [0, 1, 2]
        data.mgrmap = { active_name: 'pve1', standbys: [{ name: 'pve2' }] }
      }

      return data
    })

    const res = await run({ focus: 'improvements' })

    expect(res.healthStatus).toBe('HEALTH_OK')
    expect(res.allClear).toBe(res.findings.length === 0)
  })
})

describe('the other views', () => {
  it("keeps focus='devices' to the device class counts that answer the NVMe question", async () => {
    const res = await run({ focus: 'devices' })

    // nvme and hdd stated at zero: a missing class does not read as "none".
    expect(res.deviceClassCounts).toEqual({ nvme: 0, ssd: 3, hdd: 0 })
    expect(res.osdTotal).toBe(3)
    expect(res.capacity).toBeUndefined()
    expect(res.findings).toBeUndefined()
  })

  it("keeps focus='capacity' to capacity and per-pool usage", async () => {
    const res = await run({ focus: 'capacity' })

    expect(res.capacity).toBeDefined()
    expect(res.pools.map((p: any) => p.name)).toEqual(['.mgr', 'CephPool'])
    expect(res.deviceClassCounts).toBeUndefined()
    expect(res.findings).toBeUndefined()
  })

  it('still returns the full payload when no focus is given', async () => {
    const res = await run({})

    expect(res.observations.length).toBeGreaterThan(0)
    expect(res.health).toBeDefined()
    expect(res.capacity).toBeDefined()
    expect(res.pools).toBeDefined()
    expect(res.deviceClassCounts).toBeDefined()
  })

  it('rejects a focus value the model invented, naming the accepted ones', async () => {
    // Falling back to the full payload silently used to hide the mistake from
    // the model; naming the accepted values gets the next call right.
    await expect(run({ focus: 'everything-please' })).rejects.toThrow(ToolArgumentError)
    await expect(run({ focus: 'everything-please' })).rejects.toThrow('Accepted values: all, improvements, capacity, devices')
  })

  it('reports a cluster without Ceph rather than throwing, whatever the focus', async () => {
    pveFetch.mockRejectedValue(new Error('501 no such cluster'))

    for (const focus of ['improvements', 'capacity', 'devices', 'all']) {
      const res = await run({ focus })

      expect(res.hasCeph).toBe(false)
      expect(res.cluster).toBe('PVE-CLUSTER')
    }
  })
})

describe('list_ceph_osds ordering arguments', () => {
  async function listOsds(args: Record<string, unknown>) {
    const { listCephOsdsTool } = await import('./ceph')

    return listCephOsdsTool.execute(args, ctx()) as Promise<any>
  }

  it('still answers the per-host question when the sort value is invented', async () => {
    // llama3.1:8b sent sortBy="none" (borrowed from groupBy), was refused, and
    // answered that the data did not say. The per-host roll-up never depended
    // on the sort.
    const res = await listOsds({ groupBy: 'host', sortBy: 'none' })

    expect(res.sortBy).toBe('latency')
    expect(res.argumentNotes).toEqual(['sortBy="none" is not accepted (latency, usage, id), used "latency".'])
    expect(res.byHost.map((h: any) => [h.host, h.osdCount])).toEqual([['pve1', 1], ['pve2', 1], ['pve3', 1]])
  })

  it('states every standard device class, at zero when absent', async () => {
    const res = await listOsds({})

    expect(Object.fromEntries(Object.entries(res.byDeviceClass).map(([k, v]: [string, any]) => [k, v.count]))).toEqual({ nvme: 0, ssd: 3, hdd: 0 })
  })

  it('leaves no note when the arguments are valid', async () => {
    const res = await listOsds({ groupBy: 'device_class', sortBy: 'usage' })

    expect(res.groupBy).toBe('device_class')
    expect(res.argumentNotes).toBeUndefined()
  })
})
