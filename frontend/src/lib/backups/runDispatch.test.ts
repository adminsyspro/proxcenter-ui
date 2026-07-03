import { describe, it, expect } from 'vitest'

import { buildSharedVzdumpParams, planBackupRunDispatch, type VmLocation } from './runDispatch'

const LOCATIONS: VmLocation[] = [
  { vmid: 105, node: 'pve-r730-01', status: 'running' },
  { vmid: 106, node: 'pve-r730-01', status: 'stopped' },
  { vmid: 200, node: 'pve-r240', status: 'running' },
  { vmid: 300, node: 'pve-r730-02', status: 'running' },
]
const ONLINE = ['pve-r240', 'pve-r730-01', 'pve-r730-02']

describe('planBackupRunDispatch', () => {
  it('runs a pinned job exactly on its node (vmid selection)', () => {
    const plan = planBackupRunDispatch({
      job: { node: 'pve-r240', vmid: '105' },
      vmLocations: LOCATIONS,
      onlineNodes: ONLINE,
    })
    expect(plan.entries).toEqual([{ node: 'pve-r240', selection: { vmid: '105' } }])
    expect(plan.unresolved).toEqual([])
  })

  it('keeps the exclude list for a pinned all-guests job', () => {
    const plan = planBackupRunDispatch({
      job: { node: 'pve-r240', all: 1, exclude: '999' },
      vmLocations: LOCATIONS,
      onlineNodes: ONLINE,
    })
    expect(plan.entries).toEqual([{ node: 'pve-r240', selection: { all: '1', exclude: '999' } }])
  })

  it('#537: routes an unpinned single-VM job to the node hosting that VM, not nodes[0]', () => {
    // The r730 cluster case: VM 105 lives on pve-r730-01 but the old code sent
    // vzdump to nodes[0] (pve-r240) and backed up nothing.
    const plan = planBackupRunDispatch({
      job: { vmid: '105' },
      vmLocations: LOCATIONS,
      onlineNodes: ONLINE,
    })
    expect(plan.entries).toEqual([{ node: 'pve-r730-01', selection: { vmid: '105' } }])
    expect(plan.unresolved).toEqual([])
  })

  it('groups an unpinned multi-VM job by the node hosting each guest', () => {
    const plan = planBackupRunDispatch({
      job: { vmid: '105,106,200' },
      vmLocations: LOCATIONS,
      onlineNodes: ONLINE,
    })
    // 105 & 106 -> pve-r730-01 (grouped), 200 -> pve-r240
    expect(plan.entries).toContainEqual({ node: 'pve-r730-01', selection: { vmid: '105,106' } })
    expect(plan.entries).toContainEqual({ node: 'pve-r240', selection: { vmid: '200' } })
    expect(plan.entries).toHaveLength(2)
  })

  it('reports vmids that are unknown or on an offline node as unresolved', () => {
    const plan = planBackupRunDispatch({
      job: { vmid: '105,300,999' },
      vmLocations: LOCATIONS,
      onlineNodes: ['pve-r730-01'], // pve-r730-02 (hosts 300) is offline
    })
    expect(plan.entries).toEqual([{ node: 'pve-r730-01', selection: { vmid: '105' } }])
    expect(plan.unresolved).toEqual([300, 999])
  })

  it('fans an unpinned all-guests job out to every online node', () => {
    const plan = planBackupRunDispatch({
      job: { all: 1, exclude: '999' },
      vmLocations: LOCATIONS,
      onlineNodes: ONLINE,
    })
    expect(plan.entries).toEqual(
      ONLINE.map((node) => ({ node, selection: { all: '1', exclude: '999' } })),
    )
  })

  it('resolves an unpinned pool job from its member vmids', () => {
    const plan = planBackupRunDispatch({
      job: { pool: 'prod' },
      poolVmids: [105, 200],
      vmLocations: LOCATIONS,
      onlineNodes: ONLINE,
    })
    expect(plan.entries).toContainEqual({ node: 'pve-r730-01', selection: { vmid: '105' } })
    expect(plan.entries).toContainEqual({ node: 'pve-r240', selection: { vmid: '200' } })
  })

  it('returns no entries when there is no selection', () => {
    const plan = planBackupRunDispatch({ job: {}, vmLocations: LOCATIONS, onlineNodes: ONLINE })
    expect(plan.entries).toEqual([])
  })
})

describe('buildSharedVzdumpParams', () => {
  it('replays the core + retention/notification options a job configures', () => {
    const p = buildSharedVzdumpParams({
      storage: 'PBS',
      mode: 'snapshot',
      compress: 'zstd',
      'prune-backups': 'keep-last=3',
      'notes-template': '{{guestname}}',
      'pbs-change-detection-mode': 'data',
      bwlimit: 51200,
      zstd: 2,
      protected: 1,
      'notification-mode': 'notification-system',
      mailto: 'ops@example.com',
    })
    expect(p).toEqual({
      storage: 'PBS',
      mode: 'snapshot',
      compress: 'zstd',
      'prune-backups': 'keep-last=3',
      'notes-template': '{{guestname}}',
      'pbs-change-detection-mode': 'data',
      bwlimit: '51200',
      zstd: '2',
      protected: '1',
      'notification-mode': 'notification-system',
      mailto: 'ops@example.com',
    })
  })

  it('skips object-typed prune-backups/fleecing so we never send [object Object]', () => {
    const p = buildSharedVzdumpParams({
      storage: 'PBS',
      'prune-backups': { 'keep-last': 3 },
      fleecing: { enabled: 1, storage: 'local' },
    })
    expect(p['prune-backups']).toBeUndefined()
    expect(p.fleecing).toBeUndefined()
  })

  it('forwards string-typed fleecing as-is', () => {
    const p = buildSharedVzdumpParams({ storage: 'PBS', fleecing: 'enabled=1,storage=local' })
    expect(p.fleecing).toBe('enabled=1,storage=local')
  })

  it('never forwards the deprecated mailnotification (rejected by PVE 9)', () => {
    const p = buildSharedVzdumpParams({ storage: 'PBS', mailnotification: 'always' } as any)
    expect(p).not.toHaveProperty('mailnotification')
  })
})
