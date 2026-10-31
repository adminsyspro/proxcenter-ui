/**
 * Preflight and target resolution of action cards (roadmap#188), as the
 * execute route replays them: no assistant context, a block for anything that
 * would fail or that could not be checked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  pveFetch: vi.fn(),
  denied: new Set<string>(),
  vdcPools: null as Set<string> | null,
  recs: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => h.pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id }) }))
vi.mock('@/lib/db/settings', () => ({ getSetting: async () => null }))
vi.mock('@/lib/vdc/backupJobs', () => ({ getAllowedJobPools: async () => h.vdcPools }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => true }))
vi.mock('@/lib/orchestrator/client', () => ({ getOrchestratorClient: () => ({ getRecommendations: h.recs }) }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { NODE_MANAGE: 'node.manage', AUTOMATION_VIEW: 'automation.view' },
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  checkPermission: async (permission: string, _type?: string, id?: string) => (h.denied.has(`${permission}|${id ?? ''}`) ? { status: 403 } : null),
}))

import { clearBackupJobsCache } from '@/lib/tools/backups'
import type { SnapshotGuest, SnapshotNode } from '@/lib/tools/snapshot'
import { ToolScopeError, type ToolContext } from '@/lib/tools/types'

import { preflightAction, type PreflightInput } from './preflight'
import { actionTier, resolveActionTarget } from './target'
import type { ActionCard } from './types'

const node = (name: string, over: Partial<SnapshotNode> = {}): SnapshotNode => ({
  connId: 'c1', cluster: 'PVE-PROD', name, status: 'online', cpuPct: 1, cores: 16, memPct: 20, memUsedGb: 10, memTotalGb: 64, ...over,
})

const guest = (vmid: string, name: string, over: Partial<SnapshotGuest> = {}): SnapshotGuest => ({
  connId: 'c1', cluster: 'PVE-PROD', vmid, name, type: 'VM', kind: 'qemu', status: 'running', node: 'pve1',
  cpuPct: 1, memPct: 1, memUsedGb: 2, memTotalGb: 4, template: false, ...over,
})

const ctx = (): ToolContext => ({
  snapshot: {
    clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: 4, guestCount: 4 }, { id: 'c2', name: 'PVE-DR', nodeCount: 1, guestCount: 1 }],
    nodes: [
      node('pve1'),
      node('pve2', { status: 'offline' }),
      node('pve3', { maintenance: 'maintenance' }),
      node('pve4', { memUsedGb: 62 }),
      node('pve5'),
      { ...node('pve1'), connId: 'c2', cluster: 'PVE-DR' },
    ],
    guests: [
      guest('100', 'web'),
      guest('101', 'tpl', { template: true }),
      guest('102', 'ha-vm', { haState: 'started' }),
      guest('103', 'ct', { kind: 'lxc', type: 'CT' }),
      { ...guest('100', 'dr-web'), connId: 'c2', cluster: 'PVE-DR' },
    ],
    summary: { totalGuests: 5, runningGuests: 5, stoppedGuests: 0, totalNodes: 6, onlineNodes: 5 },
    cached: false,
  },
  tenantId: 't',
  locale: 'en',
})

const target = (vmid: number, name: string, over: Partial<ActionCard['target']> = {}): ActionCard['target'] => ({
  connId: 'c1', cluster: 'PVE-PROD', node: 'pve1', vmid, guestKind: 'qemu', name, ...over,
})
const host = (name: string): ActionCard['target'] => ({ connId: 'c1', cluster: 'PVE-PROD', node: name, name })

async function firstBlock(input: PreflightInput) {
  const res = await preflightAction(input, ctx())

  return res.checks.find(c => c.level === 'block')?.text ?? null
}

beforeEach(() => {
  clearBackupJobsCache()
  h.denied.clear()
  h.vdcPools = null
  h.pveFetch.mockReset().mockResolvedValue({ allowed_nodes: ['pve5'], local_disks: [], local_resources: [] })
  h.recs.mockReset().mockResolvedValue({ data: [] })
})

describe('resolveActionTarget', () => {
  it('re-resolves a card by connection and vmid, even when another cluster reuses the vmid', () => {
    expect(resolveActionTarget({ kind: 'start', guest: '100', connId: 'c2' }, ctx())).toMatchObject({ name: 'dr-web', cluster: 'PVE-DR' })
    expect(() => resolveActionTarget({ kind: 'start', guest: '999', connId: 'c1' }, ctx())).toThrow(ToolScopeError)
    expect(() => resolveActionTarget({ kind: 'start', guest: 'web', connId: 'c1' }, ctx())).toThrow(ToolScopeError)
  })

  it('narrows a guest lookup to the named cluster', () => {
    expect(resolveActionTarget({ kind: 'start', guest: '100', cluster: 'PVE-DR' }, ctx()).name).toBe('dr-web')
  })

  it('resolves a host by name, or by connection for execute', () => {
    expect(resolveActionTarget({ kind: 'maintenance', host: 'pve5' }, ctx())).toEqual(host('pve5'))
    expect(resolveActionTarget({ kind: 'maintenance', host: 'pve1', connId: 'c2' }, ctx()).cluster).toBe('PVE-DR')
    expect(() => resolveActionTarget({ kind: 'maintenance', host: 'pve9', connId: 'c1' }, ctx())).toThrow(ToolScopeError)
    expect(() => resolveActionTarget({ kind: 'maintenance' }, ctx())).toThrow(ToolScopeError)
  })

  it('gives a container move the disruptive tier', () => {
    expect(actionTier('migrate', target(103, 'ct', { guestKind: 'lxc' }))).toBe('disruptive')
    expect(actionTier('migrate', target(100, 'web'))).toBe('safe')
    expect(actionTier('snapshot', target(103, 'ct', { guestKind: 'lxc' }))).toBe('safe')
  })
})

describe('preflightAction', () => {
  it('blocks a guest gone from the snapshot, and a template', async () => {
    expect(await firstBlock({ kind: 'start', target: target(999, 'gone'), params: {} })).toContain('not visible')
    expect(await firstBlock({ kind: 'snapshot', target: target(101, 'tpl'), params: { name: 'snap1' } })).toContain('template')
  })

  it('checks the snapshot name', async () => {
    expect(await firstBlock({ kind: 'snapshot', target: target(100, 'web'), params: { name: '9bad' } })).toContain('not a valid snapshot name')
    expect(await firstBlock({ kind: 'snapshot', target: target(100, 'web'), params: { name: 'before-upgrade' } })).toBeNull()
  })

  it('warns that HA keeps a guest it manages stopped after a shutdown', async () => {
    const res = await preflightAction({ kind: 'shutdown', target: target(102, 'ha-vm'), params: {} }, ctx())

    expect(res.ok).toBe(true)
    expect(res.checks.some(c => c.level === 'warn' && c.text.includes('HA'))).toBe(true)
  })

  it.each([
    ['pve1', 'already runs'],
    ['pve2', 'offline'],
    ['pve3', 'maintenance'],
    ['pve4', 'GB free'],
    ['pve9', 'not a visible host'],
  ])('blocks a move to %s', async (dest, text) => {
    expect(await firstBlock({ kind: 'migrate', target: target(100, 'web'), params: { target: dest, online: true } })).toContain(text)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('blocks on host-bound resources and on a failed precondition read', async () => {
    h.pveFetch.mockResolvedValueOnce({ allowed_nodes: ['pve5'], local_disks: [], local_resources: ['hostpci0'] })
    expect(await firstBlock({ kind: 'migrate', target: target(100, 'web'), params: { target: 'pve5', online: true } })).toContain('hostpci0')

    h.pveFetch.mockRejectedValueOnce(new Error('596 timeout'))
    expect(await firstBlock({ kind: 'migrate', target: target(100, 'web'), params: { target: 'pve5', online: true } })).toContain('596 timeout')

    expect(await firstBlock({ kind: 'migrate', target: target(100, 'web'), params: { target: 'pve5', online: true } })).toBeNull()
  })

  it('skips the precondition read inside a plan', async () => {
    const res = await preflightAction({ kind: 'migrate', target: target(100, 'web'), params: { target: 'pve5', online: true } }, ctx(), { inPlan: true })

    expect(res.ok).toBe(true)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('replays a DRS recommendation against what the orchestrator says now', async () => {
    const rec = { id: 'r1', connection_id: 'c1', vmid: 100, source_node: 'pve1', target_node: 'pve5', status: 'pending', priority: 'high' }
    const drs = (r: Record<string, unknown> | null) => {
      h.recs.mockResolvedValueOnce(r ? { data: [r] } : { data: [] })

      return firstBlock({ kind: 'drs_apply', target: target(100, 'web'), params: { recommendationId: 'r1' } })
    }

    expect(await drs(rec)).toBeNull()
    expect(await drs(null)).toContain('no longer exists')
    expect(await drs({ ...rec, status: 'executed' })).toContain('executed')
    expect(await drs({ ...rec, target_node: 'pve9' })).toContain('outside your view')
    expect(await drs({ ...rec, vmid: 102 })).toContain('another guest')
    expect(await drs({ ...rec, source_node: 'pve5' })).toContain('no longer on')

    h.recs.mockRejectedValueOnce(new Error('down'))
    expect(await firstBlock({ kind: 'drs_apply', target: target(100, 'web'), params: { recommendationId: 'r1' } })).toContain('not reachable')
  })

  it('checks the backup job the guest joins', async () => {
    h.pveFetch.mockResolvedValue([{ id: 'pool-job', pool: 'gold' }, { id: 'off', vmid: '1', enabled: 0 }])

    const add = (jobId: string) => preflightAction({ kind: 'backup_add', target: target(100, 'web'), params: { jobId } }, ctx())

    expect((await add('pool-job')).checks[0].text).toContain('pool')
    expect((await add('nope')).checks[0].text).toContain('does not exist')

    const disabled = await add('off')

    expect(disabled.ok).toBe(true)
    expect(disabled.checks.some(c => c.level === 'warn')).toBe(true)

    h.vdcPools = new Set()
    expect((await add('off')).checks[0].text).toContain('vDC')
  })

  it('checks maintenance against the host state and the manage right', async () => {
    const m = (name: string, mode: string) => firstBlock({ kind: 'maintenance', target: host(name), params: { mode } })

    expect(await m('pve3', 'enter')).toContain('already in maintenance')
    expect(await m('pve2', 'enter')).toContain('offline')
    expect(await m('pve3', 'exit')).toBeNull()
    expect(await m('pve5', 'sideways')).toContain('Unknown maintenance mode')
    expect(await m('pve9', 'enter')).toContain('not visible')

    h.denied.add('node.manage|c1:pve5')
    expect(await m('pve5', 'enter')).toContain('permission')
  })

  it('blocks an unknown kind rather than throwing', async () => {
    const res = await preflightAction({ kind: 'delete' as never, target: target(100, 'web'), params: {} }, ctx())

    expect(res.ok).toBe(false)
  })
})
