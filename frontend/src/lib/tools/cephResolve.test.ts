/**
 * Which clusters a Ceph question is about when the model names none (#459).
 *
 * Asking the model to name the cluster was a dead end twice: llama3.1:8b spent
 * four rounds guessing argument names on an estate with one Ceph cluster, and
 * on the lab, with Ceph on two clusters, took the refusal for an answer. The
 * snapshot already knows which clusters report a Ceph health.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { InventorySnapshot } from '@/lib/tools/snapshot'
import { MAX_CEPH_CLUSTERS_PER_CALL, resolveCephConnections } from './ceph'
import { ToolScopeError, type ToolContext } from './types'

const pveFetch = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
}))

function ctxWith(clusters: InventorySnapshot['clusters']): ToolContext {
  return {
    snapshot: {
      clusters,
      nodes: clusters.map(c => ({
        connId: c.id, cluster: c.name, name: `${c.name}-n1`, status: 'online', cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 8,
      })),
      guests: [],
      summary: { totalGuests: 0, runningGuests: 0, stoppedGuests: 0, totalNodes: clusters.length, onlineNodes: clusters.length },
      cached: false,
    },
    tenantId: 't',
    locale: 'en',
  }
}

const prod = { id: 'c1', name: 'prod', nodeCount: 3, guestCount: 10, cephHealth: 'HEALTH_OK' }
const lab = { id: 'c2', name: 'lab', nodeCount: 1, guestCount: 2 }
const dr = { id: 'c3', name: 'dr', nodeCount: 3, guestCount: 4, cephHealth: 'HEALTH_WARN' }

describe('resolveCephConnections', () => {
  it('picks the one visible cluster that reports Ceph when none is named', () => {
    expect(resolveCephConnections(ctxWith([lab, prod]))).toEqual([{ id: 'c1', name: 'prod' }])
  })

  it('covers every cluster that reports Ceph rather than asking to pick one', () => {
    expect(resolveCephConnections(ctxWith([prod, lab, dr]))).toEqual([{ id: 'c1', name: 'prod' }, { id: 'c3', name: 'dr' }])
  })

  it('caps how many Ceph clusters one call covers', () => {
    const many = Array.from({ length: MAX_CEPH_CLUSTERS_PER_CALL + 2 }, (_, i) => ({ ...prod, id: `c${i}`, name: `ceph-${i}` }))

    expect(resolveCephConnections(ctxWith(many))).toHaveLength(MAX_CEPH_CLUSTERS_PER_CALL)
  })

  it('still honours an explicit cluster, Ceph or not', () => {
    expect(resolveCephConnections(ctxWith([lab, prod]), 'lab')).toEqual([{ id: 'c2', name: 'lab' }])
  })

  it('says no cluster reports Ceph rather than asking to pick one blindly', () => {
    expect(() => resolveCephConnections(ctxWith([lab, { ...lab, id: 'c4', name: 'edge' }]))).toThrow('No visible cluster reports Ceph')
  })

  it('falls back to the single visible cluster, so a Ceph-less estate gets the hasCeph:false answer', () => {
    expect(resolveCephConnections(ctxWith([lab]))).toEqual([{ id: 'c2', name: 'lab' }])
  })

  it('refuses a cluster outside the perimeter like every other tool', () => {
    expect(() => resolveCephConnections(ctxWith([lab, prod]), 'prod-secret')).toThrow(ToolScopeError)
  })
})

describe('Ceph tools over several clusters', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Neither cluster answers: each result must still name its own cluster.
    pveFetch.mockReset().mockRejectedValue(new Error('501 no ceph'))
  })

  it('returns one result per Ceph cluster, each naming its cluster', async () => {
    const { getCephStatusTool, listCephOsdsTool } = await import('./ceph')

    for (const tool of [getCephStatusTool, listCephOsdsTool]) {
      const res = await tool.execute({}, ctxWith([prod, lab, dr])) as any

      expect(res.clusterCount).toBe(2)
      expect(res.note).toBeUndefined()
      expect(res.clusters.map((c: any) => c.cluster)).toEqual(['prod', 'dr'])
    }
  })

  it('says how many Ceph clusters were left out', async () => {
    const { getCephStatusTool } = await import('./ceph')
    const many = Array.from({ length: MAX_CEPH_CLUSTERS_PER_CALL + 1 }, (_, i) => ({ ...prod, id: `c${i}`, name: `ceph-${i}` }))

    const res = await getCephStatusTool.execute({ focus: 'improvements' }, ctxWith(many)) as any

    expect(res.clusters).toHaveLength(MAX_CEPH_CLUSTERS_PER_CALL)
    expect(res.note).toBe(`${MAX_CEPH_CLUSTERS_PER_CALL + 1} clusters run Ceph, only the first ${MAX_CEPH_CLUSTERS_PER_CALL} are shown. Pass "cluster" for another one.`)
  })

  it('keeps the flat shape for a single cluster', async () => {
    const { getCephStatusTool } = await import('./ceph')

    expect(await getCephStatusTool.execute({}, ctxWith([prod, lab]))).toEqual({ hasCeph: false, cluster: 'prod' })
  })

  it('rejects an invented focus once, before reaching any cluster', async () => {
    const { getCephStatusTool } = await import('./ceph')

    await expect(getCephStatusTool.execute({ focus: 'everything' }, ctxWith([prod, dr]))).rejects.toThrow('Accepted values')
    expect(pveFetch).not.toHaveBeenCalled()
  })

  it('merges the findings of every cluster into one list, each naming its cluster', async () => {
    const { getCephStatusTool } = await import('./ceph')

    pveFetch.mockImplementation(async (conn: { id: string }, path: string) => {
      if (path.includes('/ceph/status')) {
        const check = conn.id === 'c1'
          ? { MON_DISK_LOW: { severity: 'HEALTH_WARN', summary: { message: 'mon pve1 is low on available space' } } }
          : { OSDMAP_FLAGS: { severity: 'HEALTH_WARN', summary: { message: 'noout flag(s) set' } } }

        return { health: { status: 'HEALTH_WARN', checks: check }, pgmap: {}, monmap: { mons: [] }, quorum: [], mgrmap: {} }
      }

      return []
    })

    const res = await getCephStatusTool.execute({ focus: 'improvements' }, ctxWith([prod, dr])) as any

    expect(res.findings).toContain('prod: Ceph check MON_DISK_LOW (HEALTH_WARN): mon pve1 is low on available space.')
    expect(res.findings).toContain('dr: Ceph check OSDMAP_FLAGS (HEALTH_WARN): noout flag(s) set.')
    expect(res.findingCount).toBe(res.findings.length)
    expect(res.allClear).toBe(false)
  })

  it('adds no findings roll-up to the capacity view, which carries none', async () => {
    const { getCephStatusTool } = await import('./ceph')

    const res = await getCephStatusTool.execute({ focus: 'capacity' }, ctxWith([prod, dr])) as any

    expect(res.findings).toBeUndefined()
    expect(res.allClear).toBeUndefined()
  })

  it('sums device classes across clusters for the devices view', async () => {
    const { getCephStatusTool } = await import('./ceph')

    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.includes('/ceph/status')) return { health: { status: 'HEALTH_OK', checks: {} }, pgmap: {}, monmap: { mons: [] }, quorum: [], mgrmap: {} }
      if (path.includes('/ceph/osd')) {
        return { root: { children: [{ id: -1, name: 'default', type: 'root', children: [
          { id: 0, name: 'osd.0', type: 'osd', device_class: 'hdd', status: 'up', in: 1, host: 'n1' },
        ] }] } }
      }

      return []
    })

    const res = await getCephStatusTool.execute({ focus: 'devices' }, ctxWith([prod, dr])) as any

    expect(res.deviceClassCounts).toEqual({ nvme: 0, ssd: 0, hdd: 2 })
  })

  it('totals OSDs across clusters, per host and per device class', async () => {
    const { listCephOsdsTool } = await import('./ceph')

    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.includes('/ceph/status')) return { health: { status: 'HEALTH_OK', checks: {} }, pgmap: {}, monmap: { mons: [] }, quorum: [], mgrmap: {} }
      if (path.includes('/ceph/osd')) {
        return { root: { children: [{ id: -1, name: 'default', type: 'root', children: [
          { id: 0, name: 'osd.0', type: 'osd', device_class: 'hdd', status: 'up', in: 1, host: 'n1' },
          { id: 1, name: 'osd.1', type: 'osd', device_class: 'hdd', status: 'up', in: 1, host: 'n2' },
        ] }] } }
      }

      return []
    })

    const res = await listCephOsdsTool.execute({}, ctxWith([prod, dr])) as any

    expect(res.osdTotal).toBe(4)
    expect(res.osdCountByDeviceClass).toEqual({ nvme: 0, ssd: 0, hdd: 4 })
    expect(res.osdCountByHost).toEqual([
      { cluster: 'prod', host: 'n1', osdCount: 1 },
      { cluster: 'prod', host: 'n2', osdCount: 1 },
      { cluster: 'dr', host: 'n1', osdCount: 1 },
      { cluster: 'dr', host: 'n2', osdCount: 1 },
    ])
  })
})
