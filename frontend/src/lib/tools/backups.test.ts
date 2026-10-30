import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { ToolContext } from './types'

const pveFetch = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
}))
vi.mock('@/lib/db/settings', () => ({ getSetting: async () => null }))

import { clearBackupJobsCache, getBackupCoverageTool } from './backups'

const guest = (connId: string, cluster: string, vmid: string, over: Record<string, unknown> = {}) => ({
  connId, cluster, vmid, name: `vm-${vmid}`, type: 'VM' as const, kind: 'qemu' as const, status: 'running', node: 'pve1',
  cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 4, template: false, ...over,
})

const ctx = (): ToolContext => ({
  snapshot: {
    clusters: [
      { id: 'c1', name: 'PVE-PROD', nodeCount: 1, guestCount: 3 },
      { id: 'c2', name: 'PVE-DR', nodeCount: 1, guestCount: 1 },
    ],
    nodes: [],
    guests: [
      guest('c1', 'PVE-PROD', '101'),
      guest('c1', 'PVE-PROD', '102'),
      guest('c1', 'PVE-PROD', '103', { tags: 'no-backup' }),
      guest('c1', 'PVE-PROD', '900', { template: true }),
      guest('c2', 'PVE-DR', '201'),
    ],
    summary: { totalGuests: 5, runningGuests: 5, stoppedGuests: 0, totalNodes: 0, onlineNodes: 0 },
    cached: false,
  },
  tenantId: 't',
  locale: 'en',
})

beforeEach(() => {
  clearBackupJobsCache()
  pveFetch.mockReset().mockImplementation(async (conn: { id: string }) => (conn.id === 'c1' ? [{ id: 'job1', vmid: '101' }] : []))
})

describe('get_backup_coverage', () => {
  it('lists the unprotected guests per cluster and reason, with one read per cluster', async () => {
    const res = (await getBackupCoverageTool.execute({}, ctx())) as any

    expect(pveFetch).toHaveBeenCalledTimes(2)
    expect(pveFetch.mock.calls.every(c => c[1] === '/cluster/backup')).toBe(true)
    expect(res).toMatchObject({ checked: 4, protected: 1, unprotected: 2, ignoredTemplates: 1, ignoredByOptOutTag: 1, optOutTag: 'no-backup' })
    expect(res.unprotectedByCluster).toEqual([
      { cluster: 'PVE-PROD', reason: 'no job selects it', guests: ['vm-102 (VM 102, pve1)'] },
      { cluster: 'PVE-DR', reason: 'no backup job exists on this cluster', guests: ['vm-201 (VM 201, pve1)'] },
    ])
  })

  it('reads the jobs once a minute, whatever the questions', async () => {
    await getBackupCoverageTool.execute({}, ctx())
    await getBackupCoverageTool.execute({ cluster: 'PVE-PROD' }, ctx())

    expect(pveFetch).toHaveBeenCalledTimes(2)
  })

  it('leaves out a cluster whose jobs cannot be read rather than flag all its guests', async () => {
    pveFetch.mockImplementation(async (conn: { id: string }) => {
      if (conn.id === 'c2') throw new Error('401')

      return [{ id: 'job1', all: 1 }]
    })

    const res = (await getBackupCoverageTool.execute({}, ctx())) as any

    expect(res.clustersNotChecked).toEqual(['PVE-DR'])
    expect(res.unprotected).toBe(0)
  })

  it('caps the list and says how many were left out', async () => {
    const res = (await getBackupCoverageTool.execute({ limit: 1 }, ctx())) as any

    expect(res.unprotectedByCluster.flatMap((g: any) => g.guests)).toHaveLength(1)
    expect(res.notListed).toBe(1)
  })
})
