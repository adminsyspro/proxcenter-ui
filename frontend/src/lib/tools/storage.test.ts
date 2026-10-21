/**
 * `rank_storage` ranks devices, not dashboard totals (#459).
 *
 * The data mirrors the lab recette: a local ZFS-Pool of 96 GB on each of three
 * hosts, a local `local` dir of 17 GB per host with pve1 nearly full, and one
 * shared Ceph pool. Summing the local pools per cluster reported a 289 GB
 * ZFS-Pool and hid local@pve1 from "which storage has the least free space?".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { ToolContext } from './types'

const GB = 1024 ** 3
const pveFetch = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
}))

const resources = [
  ...['pve1', 'pve2', 'pve3'].map((node, i) => ({ storage: 'ZFS-Pool', node, disk: (20 + i * 10) * GB, maxdisk: 96 * GB, status: 'available' })),
  { storage: 'local', node: 'pve1', disk: 11.1 * GB, maxdisk: 17 * GB, status: 'available' },
  { storage: 'local', node: 'pve2', disk: 10.2 * GB, maxdisk: 17 * GB, status: 'available' },
  { storage: 'local', node: 'pve3', disk: 3 * GB, maxdisk: 17 * GB, status: 'available' },
  ...['pve1', 'pve2', 'pve3'].map(node => ({ storage: 'CephPool', node, disk: 17 * GB, maxdisk: 90 * GB, status: 'available', shared: 1 })),
]

const configs = [
  { storage: 'ZFS-Pool', type: 'zfspool', content: 'images,rootdir' },
  { storage: 'local', type: 'dir', content: 'iso,vztmpl,backup' },
  { storage: 'CephPool', type: 'rbd', content: 'images', shared: 1 },
]

const ctx: ToolContext = {
  snapshot: {
    clusters: [{ id: 'PVE-PROD', name: 'PVE-PROD', nodeCount: 3, guestCount: 0, cephHealth: 'HEALTH_WARN' }],
    nodes: [],
    guests: [],
    summary: { totalGuests: 0, runningGuests: 0, stoppedGuests: 0, totalNodes: 3, onlineNodes: 3 },
    cached: false,
  },
  tenantId: 't',
  locale: 'en',
}

async function rank(args: Record<string, unknown>) {
  const { rankStorageTool } = await import('./storage')

  return rankStorageTool.execute(args, ctx) as Promise<any>
}

beforeEach(() => {
  pveFetch.mockReset().mockImplementation(async (_conn: unknown, path: string) => (path.startsWith('/cluster/resources') ? resources : configs))
})

describe('rank_storage', () => {
  it('ranks a local pool once per host, with its host, and a shared pool once', async () => {
    const res = await rank({ metric: 'total', limit: 10 })

    expect(res.totalConsidered).toBe(7)
    expect(res.ranking[0]).toMatchObject({ name: 'ZFS-Pool', totalGb: 96, shared: false, nodeCount: 1 })
    expect(res.ranking.filter((r: any) => r.name === 'ZFS-Pool').map((r: any) => r.host).sort()).toEqual(['pve1', 'pve2', 'pve3'])
    expect(res.ranking.find((r: any) => r.name === 'CephPool')).toMatchObject({ totalGb: 90, shared: true, host: null })
  })

  it('finds the nearly full local storage of one host for the least-free question', async () => {
    const res = await rank({ metric: 'free', limit: 1 })

    expect(res.ranking).toEqual([expect.objectContaining({ rank: 1, name: 'local', host: 'pve1', freeGb: 5.9 })])
  })

  it('reads a content of "None" as no filter', async () => {
    const res = await rank({ metric: 'free', limit: 1, content: 'None' })

    expect(res.ranking[0]).toMatchObject({ name: 'local', host: 'pve1' })
  })

  it('keeps only the storages holding the requested content', async () => {
    const res = await rank({ metric: 'total', content: 'backup' })

    expect(res.ranking.map((r: any) => r.name)).toEqual(['local', 'local', 'local'])
  })

  it('refuses a content filter that matches nothing, naming the content types present', async () => {
    await expect(rank({ content: 'snippets' })).rejects.toThrow('No storage holds content "snippets". Content types present: backup, images, iso, rootdir, vztmpl.')
  })
})

