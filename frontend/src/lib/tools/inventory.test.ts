/**
 * `list_guests` and `list_hosts` answer from the RBAC-filtered snapshot only,
 * with no Proxmox round trip (#459).
 */

import { describe, it, expect } from 'vitest'

import type { SnapshotGuest, SnapshotNode } from '@/lib/tools/snapshot'
import { listGuestsTool, listHostsTool } from './inventory'
import { ToolArgumentError, ToolScopeError, type ToolContext } from './types'

function guest(o: Partial<SnapshotGuest> & { name: string; vmid: string }): SnapshotGuest {
  return {
    connId: 'c1', cluster: 'PVE-PROD', type: 'VM', kind: 'qemu', status: 'running', node: 'pve1',
    cpuPct: 1, memPct: 10, memUsedGb: 1, memTotalGb: 4, vcpus: 2, template: false,
    ...o,
  }
}

function node(o: Partial<SnapshotNode> & { name: string }): SnapshotNode {
  return { connId: 'c1', cluster: 'PVE-PROD', status: 'online', cpuPct: 3, cores: 8, memPct: 40, memUsedGb: 6, memTotalGb: 16, ...o }
}

const ctx: ToolContext = {
  snapshot: {
    clusters: [
      { id: 'c1', name: 'PVE-PROD', nodeCount: 2, guestCount: 3, cephHealth: 'HEALTH_WARN' },
      { id: 'c2', name: 'PVE-DR', nodeCount: 1, guestCount: 1 },
    ],
    nodes: [node({ name: 'pve1' }), node({ name: 'pve2', maintenance: 'maintenance' }), node({ name: 'pve1-dr', connId: 'c2', cluster: 'PVE-DR' })],
    guests: [
      guest({ name: 'db-01', vmid: '101', pool: 'Prod', tags: 'db;critical' }),
      guest({ name: 'web-01', vmid: '102', node: 'pve2', tags: 'web' }),
      guest({ name: 'old-01', vmid: '150', status: 'stopped', pool: 'prod' }),
      guest({ name: 'dr-01', vmid: '5101', connId: 'c2', cluster: 'PVE-DR', node: 'pve1-dr' }),
    ],
    summary: { totalGuests: 4, runningGuests: 3, stoppedGuests: 1, totalNodes: 3, onlineNodes: 3 },
    cached: true,
  },
  tenantId: 't',
  locale: 'en',
}

const names = (res: any) => res.guests.map((g: any) => g.name)

describe('list_guests', () => {
  it('lists every visible guest by default', async () => {
    const res = await listGuestsTool.execute({}, ctx) as any

    expect(res).toMatchObject({ total: 4, returned: 4, truncated: false })
    expect(res.guests[0]).toMatchObject({ name: 'db-01', vmid: '101', cluster: 'PVE-PROD', vcpus: 2, memoryGb: 4 })
  })

  it('filters on run state, cluster, host, pool and tag', async () => {
    expect(names(await listGuestsTool.execute({ status: 'stopped' }, ctx))).toEqual(['old-01'])
    expect(names(await listGuestsTool.execute({ status: 'running', cluster: 'pve-dr' }, ctx))).toEqual(['dr-01'])
    expect(names(await listGuestsTool.execute({ node: 'PVE2' }, ctx))).toEqual(['web-01'])
    expect(names(await listGuestsTool.execute({ pool: 'prod' }, ctx))).toEqual(['db-01', 'old-01'])
    expect(names(await listGuestsTool.execute({ tag: 'Critical' }, ctx))).toEqual(['db-01'])
  })

  it('says when the limit cut the list', async () => {
    const res = await listGuestsTool.execute({ limit: 2 }, ctx) as any

    expect(res).toMatchObject({ total: 4, returned: 2, truncated: true })
  })

  it('refuses an unknown cluster and an invented status', async () => {
    await expect(listGuestsTool.execute({ cluster: 'secret' }, ctx)).rejects.toThrow(ToolScopeError)
    await expect(listGuestsTool.execute({ status: 'paused' }, ctx)).rejects.toThrow(ToolArgumentError)
  })
})

describe('list_hosts', () => {
  it('lists every visible host with the cluster roll-up', async () => {
    const res = await listHostsTool.execute({}, ctx) as any

    expect(res.total).toBe(3)
    expect(res.clusters).toEqual([
      { name: 'PVE-PROD', hosts: 2, guests: 3, cephHealth: 'HEALTH_WARN' },
      { name: 'PVE-DR', hosts: 1, guests: 1, cephHealth: null },
    ])
    expect(res.hosts.find((h: any) => h.name === 'pve2')).toMatchObject({ cores: 8, memoryTotalGb: 16, maintenance: 'maintenance' })
    expect(res.hosts.find((h: any) => h.name === 'pve1').maintenance).toBeNull()
  })

  it('restricts to one cluster', async () => {
    const res = await listHostsTool.execute({ cluster: 'PVE-DR' }, ctx) as any

    expect(res.hosts.map((h: any) => h.name)).toEqual(['pve1-dr'])
  })
})
