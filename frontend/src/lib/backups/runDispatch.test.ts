import { describe, it, expect } from 'vitest'

import { buildSharedVzdumpParams, planBackupRunDispatch, vzdumpRunBody, type VmLocation } from './runDispatch'
import { jobInvocation, parseVzdumpCommandLine } from './vzdumpCommandLine'
import { jobMatches } from './vzdumpRuns'

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

  it('prints object-typed property strings the way PVE does (sorted keys)', () => {
    const p = buildSharedVzdumpParams({
      storage: 'PBS',
      'prune-backups': { 'keep-last': '3', 'keep-daily': '2' },
      fleecing: { enabled: 1, storage: 'local' },
      performance: { 'max-workers': 4 },
    })
    expect(p['prune-backups']).toBe('keep-daily=2,keep-last=3')
    expect(p.fleecing).toBe('enabled=1,storage=local')
    expect(p.performance).toBe('max-workers=4')
  })

  it('never sends job metadata, selection, node or restricted keys', () => {
    const p = buildSharedVzdumpParams({
      id: 'j', type: 'vzdump', enabled: 1, schedule: '02:00', comment: 'c', 'repeat-missed': 1, 'next-run': 1,
      all: 1, vmid: '100', pool: 'p', exclude: '1', node: 'pve1', tmpdir: '/t', dumpdir: '/d', script: '/s',
      storage: 'PBS', 'notification-target': 'ops', remove: 1,
    } as any)
    expect(p).toEqual({ storage: 'PBS', 'notification-target': 'ops', remove: '1' })
  })

  it('a Run now built from these params matches its job (#1003)', () => {
    const job = {
      id: 'backup-x', type: 'vzdump', schedule: '02:00', enabled: 1, vmid: '100,103', storage: 'PBS', mode: 'snapshot',
      compress: 'zstd', 'prune-backups': { 'keep-last': '3' }, 'notes-template': "{{guestname}} it's", protected: 1,
      'notification-mode': 'notification-system',
    }
    const quote = (v: string) => (/^[\w\-.\/:@,=+]+$/.test(v) ? v : `'${v.replace(/'/g, `'"'"'`)}'`)
    const params = { ...buildSharedVzdumpParams(job), node: 'pve2' }
    const line =
      'INFO: starting new backup job: vzdump 103 ' +
      Object.entries(params).map(([k, v]) => `--${k} ${quote(v)}`).join(' ')
    expect(jobMatches(jobInvocation(job), parseVzdumpCommandLine(line)!)).toBe(true)
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

describe('vzdumpRunBody (#1003 final review)', () => {
  it('sends every exclude-path as its own form key, as PVE expects a list', () => {
    const job = { id: 'j', vmid: '100', storage: 'PBS', 'exclude-path': ['/tmp/?*', '/var/cache'] }
    const body = vzdumpRunBody(buildSharedVzdumpParams(job), { vmid: '100' })
    expect(body.getAll('exclude-path')).toEqual(['/tmp/?*', '/var/cache'])
    expect(body.get('vmid')).toBe('100')
    expect(body.get('storage')).toBe('PBS')
  })

  it('round-trips: the task PVE prints for that body matches its job', () => {
    const job = { id: 'j', type: 'vzdump', vmid: '100', storage: 'PBS', 'exclude-path': ['/tmp/?*', '/var/cache'] }
    const body = vzdumpRunBody(buildSharedVzdumpParams(job), { vmid: '100' })
    const quote = (v: string) => (/^[\w\-.\/:@,=+]+$/.test(v) ? v : `'${v}'`)
    const line = 'INFO: starting new backup job: vzdump 100 ' +
      [...body.entries()].filter(([k]) => k !== 'vmid').map(([k, v]) => `--${k} ${quote(v)}`).join(' ')
    expect(line).toContain("--exclude-path '/tmp/?*' --exclude-path /var/cache")
    expect(jobMatches(jobInvocation(job), parseVzdumpCommandLine(line)!)).toBe(true)
  })

  it('lets the per-node selection override a shared key', () => {
    expect(vzdumpRunBody({ storage: 'PBS', vmid: '1' }, { vmid: '100,101' }).getAll('vmid')).toEqual(['100,101'])
  })
})

describe('job-only keys (#1003 final review)', () => {
  it('a job carrying starttime, dow and stdout still matches its runs, and Run now does not send them', () => {
    const job = { id: 'old', type: 'vzdump', vmid: '100', storage: 'PBS', mode: 'snapshot', starttime: '02:00', dow: 'mon,tue', stdout: 0 }
    const p = buildSharedVzdumpParams(job)
    expect(p).toEqual({ storage: 'PBS', mode: 'snapshot' })
    const task = parseVzdumpCommandLine('INFO: starting new backup job: vzdump 100 --storage PBS --mode snapshot --quiet 1')!
    expect(jobMatches(jobInvocation(job), task)).toBe(true)
  })
})
