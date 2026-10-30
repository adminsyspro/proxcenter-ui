/**
 * DRS and Site Recovery for the assistant (#459): licence and permission
 * gates, and the snapshot filter on rows the orchestrator returns for the
 * whole estate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { invokeTool } from './invoke'
import type { InventorySnapshot } from './snapshot'
import type { ToolContext } from './types'

const h = vi.hoisted(() => ({
  licensed: true,
  denied: false,
  client: {
    getDRSStatus: vi.fn(),
    getRecommendations: vi.fn(),
    getActiveMigrations: vi.fn(),
    getReplicationJobs: vi.fn(),
  },
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => h.licensed }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { AUTOMATION_VIEW: 'automation.view' },
  checkPermission: async () => (h.denied ? { status: 403 } : null),
}))
vi.mock('@/lib/orchestrator/client', () => ({ getOrchestratorClient: () => h.client }))

import { getDrsStatusTool, getSiteRecoveryTool } from './automation'

const guest = (connId: string, vmid: string, name: string, node: string) => ({
  connId, cluster: connId === 'c1' ? 'PVE-PROD' : 'PVE-DR', vmid, name, type: 'VM' as const, kind: 'qemu' as const, status: 'running',
  node, cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 4, template: false,
})

const snapshot = (restricted: boolean): InventorySnapshot => ({
  clusters: [
    { id: 'c1', name: 'PVE-PROD', nodeCount: 2, guestCount: 1 },
    { id: 'c2', name: 'PVE-DR', nodeCount: 1, guestCount: 0 },
  ],
  nodes: [
    { connId: 'c1', cluster: 'PVE-PROD', name: 'pve1', status: 'online', cpuPct: 10, memPct: 30, memUsedGb: 7, memTotalGb: 23.5 },
    { connId: 'c1', cluster: 'PVE-PROD', name: 'pve2', status: 'online', cpuPct: 20, memPct: 85, memUsedGb: 20, memTotalGb: 23.5 },
    { connId: 'c2', cluster: 'PVE-DR', name: 'pve1-dr', status: 'online', cpuPct: 5, memPct: 50, memUsedGb: 12, memTotalGb: 23.5 },
  ],
  guests: [guest('c1', '101', 'db-01', 'pve2')],
  summary: { totalGuests: 1, runningGuests: 1, stoppedGuests: 0, totalNodes: 3, onlineNodes: 3 },
  cached: false,
  restricted,
})

const ctx = (restricted = true): ToolContext => ({ snapshot: snapshot(restricted), tenantId: 't', locale: 'en', timeZone: 'UTC' })

beforeEach(() => {
  h.licensed = true
  h.denied = false
  h.client.getDRSStatus.mockReset().mockResolvedValue({ data: { enabled: true, mode: 'manual', recommendations: 9 } })
  h.client.getRecommendations.mockReset().mockResolvedValue({
    data: [
      { connection_id: 'c1', vmid: 101, vm_name: 'db-01', source_node: 'pve2', target_node: 'pve1', priority: 'high', reason: 'RAM 85 %', status: 'pending' },
      // A guest the caller cannot see.
      { connection_id: 'c1', vmid: 999, vm_name: 'secret', source_node: 'pve2', target_node: 'pve1', status: 'pending' },
      // A host the caller cannot see.
      { connection_id: 'c1', vmid: 101, vm_name: 'db-01', source_node: 'pve2', target_node: 'pve9', status: 'pending' },
      // Another tenant's cluster.
      { connection_id: 'c9', vmid: 101, vm_name: 'x', source_node: 'a', target_node: 'b', status: 'pending' },
    ],
  })
  h.client.getActiveMigrations.mockReset().mockResolvedValue({ data: [] })
  h.client.getReplicationJobs.mockReset()
})

describe('get_drs_status', () => {
  it('keeps only the moves whose guest and both hosts are visible, and never relays global counts', async () => {
    const res = (await getDrsStatusTool.execute({}, ctx())) as any

    expect(res.enabled).toBe(true)
    expect(res.mode).toBe('manual')
    expect(res.recommendations).toEqual([
      expect.objectContaining({ guest: 'db-01', from: 'pve2', to: 'pve1', cluster: 'PVE-PROD', reason: 'RAM 85 %' }),
    ])
    expect(JSON.stringify(res)).not.toContain('secret')
    expect(res).not.toHaveProperty('recommendationsCount')
  })

  it('measures how unbalanced each cluster is from the snapshot', async () => {
    const res = (await getDrsStatusTool.execute({}, ctx())) as any

    expect(res.balance[0]).toEqual({ cluster: 'PVE-PROD', hosts: 2, ramSpreadPoints: 55, cpuSpreadPoints: 10, busiestRamHost: 'pve2' })
  })

  it('refuses without the licence or the permission, before reading the orchestrator', async () => {
    h.licensed = false
    expect(await invokeTool(getDrsStatusTool, {}, ctx())).toMatchObject({ ok: false, error: 'out-of-scope' })

    h.licensed = true
    h.denied = true
    expect(await invokeTool(getDrsStatusTool, {}, ctx())).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(h.client.getRecommendations).not.toHaveBeenCalled()
  })

  it('says when DRS cannot be read', async () => {
    h.client.getDRSStatus.mockRejectedValue(new Error('down'))
    h.client.getRecommendations.mockRejectedValue(new Error('down'))

    expect(await getDrsStatusTool.execute({}, ctx())).toMatchObject({ available: false })
  })
})

describe('get_site_recovery_status', () => {
  const lastSync = new Date(Date.now() - 2 * 3_600_000).toISOString()
  const job = (over: Record<string, unknown>) => ({
    name: 'prod-to-dr',
    status: 'synced',
    source_cluster: 'c1',
    target_cluster: 'c2',
    vm_ids: [101],
    vm_names: ['db-01'],
    last_sync: lastSync,
    rpo_target: 3600,
    ...over,
  })

  it('reports the lag against the RPO from the rows it may show', async () => {
    h.client.getReplicationJobs.mockResolvedValue({
      data: [job({}), job({ name: 'other-tenant', source_cluster: 'c9' }), job({ name: 'hidden-guest', vm_ids: [999], vm_names: ['secret'] })],
    })

    const res = (await getSiteRecoveryTool.execute({}, ctx())) as any

    expect(res).toMatchObject({ jobs: 1, inError: 0, missingRpo: 1, protectedGuests: 1 })
    expect(res.replicationJobs[0]).toMatchObject({ name: 'prod-to-dr', from: 'PVE-PROD', to: 'PVE-DR', minutesSinceLastSync: 120, rpoTargetMinutes: 60, meetsRpo: false })
  })

  it('shows a job with guests it cannot place only to an unrestricted caller', async () => {
    h.client.getReplicationJobs.mockResolvedValue({ data: [job({ vm_ids: [999] })] })

    expect(((await getSiteRecoveryTool.execute({}, ctx(true))) as any).jobs).toBe(0)
    expect(((await getSiteRecoveryTool.execute({}, ctx(false))) as any).jobs).toBe(1)
  })

  it('carries the error of a failed job, shortened', async () => {
    h.client.getReplicationJobs.mockResolvedValue({ data: [job({ status: 'error', error_message: 'x'.repeat(500) })] })

    const res = (await getSiteRecoveryTool.execute({}, ctx())) as any

    expect(res.inError).toBe(1)
    expect(res.replicationJobs[0].error).toHaveLength(200)
  })
})
