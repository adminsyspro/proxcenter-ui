import { describe, expect, it } from 'vitest'

import {
  PUBLIC_API_ALLOWLIST,
  getAllowlistEntryById,
  _matchAgainst,
  allowedMethodsForPath,
  isRejectedPath,
  isWriteEntry,
  type AllowlistEntry,
  matchPublicApiPath,
  matchesEntry,
  matchEntryParams,
} from './allowlist'

describe('PUBLIC_API_ALLOWLIST data', () => {
  it('keeps exactly the 7 phase-1 Monitoring entries with the spec scopes', () => {
    const byId = Object.fromEntries(PUBLIC_API_ALLOWLIST.map(e => [e.id, e]))
    expect(PUBLIC_API_ALLOWLIST.filter(e => e.tag === 'Monitoring').map(e => e.id).sort()).toEqual([
      'inventory-tree', 'pbs-backups', 'public-backups', 'public-health',
      'public-metrics', 'storage-list', 'vms-list',
    ])
    expect(new Set(PUBLIC_API_ALLOWLIST.map(e => e.id)).size).toBe(PUBLIC_API_ALLOWLIST.length)
    expect(byId['vms-list'].pattern).toBe('/api/v1/vms')
    expect(byId['vms-list'].requiredScopes).toEqual(['vms:read'])
    expect(byId['inventory-tree'].requiredScopes).toEqual(['nodes:read'])
    expect(byId['storage-list'].requiredScopes).toEqual(['storage:read'])
    expect(byId['pbs-backups'].pattern).toBe('/api/v1/pbs/{id}/backups')
    expect(byId['pbs-backups'].requiredScopes).toEqual(['backups:read'])
    expect(byId['pbs-backups'].connectionSegment).toBe('id')
    expect(byId['public-backups'].requiredScopes).toEqual(['backups:read'])
    expect(byId['public-metrics'].requiredScopes).toEqual(['nodes:read', 'vms:read', 'backups:read'])
    expect(byId['public-health'].requiredScopes).toEqual([])
    for (const entry of PUBLIC_API_ALLOWLIST) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(entry.method)
      expect(['Monitoring', 'VMs', 'Snapshots', 'Backups', 'Storage', 'HA', 'Pools', 'Network', 'Firewall', 'Tasks']).toContain(entry.tag)
      expect(entry.routeFile).toMatch(/^src\/app\/api\/v1\/.+\/route\.ts$/)
      expect(entry.summary.length).toBeGreaterThan(0)
      expect(entry.responseSchemaRef.length).toBeGreaterThan(0)
    }
  })
})

describe('shared canonical matcher', () => {
  it('matches literal patterns segment per segment, case sensitive', () => {
    expect(matchPublicApiPath('/api/v1/vms', 'GET')).toEqual({ ok: true, entryId: 'vms-list', params: {} })
    expect(matchPublicApiPath('/api/v1/VMS', 'GET').ok).toBe(false)
    expect(matchPublicApiPath('/api/v1/vms/extra', 'GET').ok).toBe(false)
    expect(matchPublicApiPath('/api/v1', 'GET').ok).toBe(false)
  })

  it('binds a named dynamic segment', () => {
    const m = matchPublicApiPath('/api/v1/pbs/conn-42/backups', 'GET')
    expect(m.ok).toBe(true)
    expect(m.entryId).toBe('pbs-backups')
    expect(m.params).toEqual({ id: 'conn-42' })
  })

  it('never matches by prefix', () => {
    expect(matchPublicApiPath('/api/v1/vms-list', 'GET').ok).toBe(false)
    expect(matchPublicApiPath('/api/v1/pbs/conn-42/backups/tail', 'GET').ok).toBe(false)
  })

  it('rejects dangerous paths BEFORE any matching', () => {
    expect(isRejectedPath('/api/v1/pbs/a%2Fb/backups')).toBe(true)
    expect(isRejectedPath('/api/v1/pbs/a%2fb/backups')).toBe(true)
    expect(isRejectedPath('/api/v1/pbs/a%5Cb/backups')).toBe(true)
    expect(isRejectedPath('/api//v1/vms')).toBe(true)
    expect(isRejectedPath('/api/v1/./vms')).toBe(true)
    expect(isRejectedPath('/api/v1/../vms')).toBe(true)
    expect(isRejectedPath('/api/v1/vms/')).toBe(true)
    expect(isRejectedPath('/api/v1/vms')).toBe(false)
    expect(matchPublicApiPath('/api/v1/vms/', 'GET').ok).toBe(false)
  })

  it('matchesEntry re-verifies against ONE designated entry only', () => {
    const vms = getAllowlistEntryById('vms-list')!
    expect(matchesEntry(vms, '/api/v1/vms', 'GET')).toBe(true)
    expect(matchesEntry(vms, '/api/v1/storage', 'GET')).toBe(false)
    const pbs = getAllowlistEntryById('pbs-backups')!
    expect(matchEntryParams(pbs, '/api/v1/pbs/conn-7/backups')).toEqual({ id: 'conn-7' })
    expect(matchEntryParams(pbs, '/api/v1/pbs/conn-7/backups/')).toBeNull()
  })

  it('getAllowlistEntryById returns null on unknown ids', () => {
    expect(getAllowlistEntryById('nope')).toBeNull()
  })

  it('the edge match and the server-side re-check against the resolved entry never disagree, and no path matches two entries', () => {
    const guest = '/api/v1/connections/c1/guests/qemu/pve1/100'
    const vmKey = '/api/v1/guests/c1:qemu:pve1:100'
    const samplePathById: Record<string, string> = {
      'vms-list': '/api/v1/vms',
      'inventory-tree': '/api/v1/inventory',
      'storage-list': '/api/v1/storage',
      'pbs-backups': '/api/v1/pbs/conn-1/backups',
      'public-backups': '/api/v1/public/backups',
      'public-metrics': '/api/v1/public/metrics',
      'public-health': '/api/v1/public/health',
      'vm-create': '/api/v1/connections/c1/guests/qemu/pve1',
      'vm-config-get': `${guest}/config`,
      'vm-config-update': `${guest}/config`,
      'vm-power': `${guest}/shutdown`,
      'vm-clone': `${guest}/clone`,
      'vm-template': `${guest}/template`,
      'vm-disk-resize': `${guest}/disk/resize`,
      'vm-disk-move': `${guest}/disk/move`,
      'vm-unlock-get': `${guest}/unlock`,
      'vm-unlock': `${guest}/unlock`,
      'vm-migrate': `${guest}/migrate`,
      'vm-remote-migrate': `${guest}/remote-migrate`,
      'vm-remote-migrate-check': `${guest}/remote-migrate/check`,
      'vm-remote-migrate-prepare-get': `${guest}/remote-migrate/prepare`,
      'vm-remote-migrate-prepare': `${guest}/remote-migrate/prepare`,
      'vm-delete': guest,
      'vm-notes-get': `${vmKey}/notes`,
      'vm-notes-update': `${vmKey}/notes`,
      'vm-snapshots-list': `${vmKey}/snapshots`,
      'vm-snapshot-create': `${vmKey}/snapshots`,
      'vm-snapshot-delete': `${vmKey}/snapshots`,
      'vm-snapshot-rollback': `${vmKey}/snapshots/before-upgrade`,
      'vm-snapshot-update': `${vmKey}/snapshots/before-upgrade`,
      'vm-tasks-list': `${vmKey}/tasks`,
      'task-status': '/api/v1/tasks/c1/pve1/UPID:pve1:0000ABCD:00001234:6A000000:qmstart:100:root@pam:',
      'backup-jobs-list': '/api/v1/connections/c1/backup-jobs',
      'backup-job-create': '/api/v1/connections/c1/backup-jobs',
      'backup-job-get': '/api/v1/connections/c1/backup-jobs/backup-1a2b',
      'backup-job-update': '/api/v1/connections/c1/backup-jobs/backup-1a2b',
      'backup-job-delete': '/api/v1/connections/c1/backup-jobs/backup-1a2b',
      'backup-job-run': '/api/v1/connections/c1/backup-jobs/backup-1a2b',
      'backup-job-guests': '/api/v1/connections/c1/backup-jobs/backup-1a2b/guests',
      'vm-backup-now': '/api/v1/connections/c1/nodes/pve1/vzdump',
      'vm-restore': '/api/v1/connections/c1/nodes/pve1/restore',
      'pbs-backup-delete': '/api/v1/pbs/p1/backups/ds1%2Fvm%2F100%2F1760000000',
      'pbs-backup-verify': '/api/v1/pbs/p1/backups/ds1%2Fns1%2Fvm%2F100%2F1760000000/verify',
      ...Object.fromEntries(['prune', 'sync', 'verify', 'tape'].flatMap(kind => [
        [`pbs-job-${kind}-create`, `/api/v1/pbs/p1/jobs/${kind}`],
        [`pbs-job-${kind}-update`, `/api/v1/pbs/p1/jobs/${kind}/job-1`],
        [`pbs-job-${kind}-delete`, `/api/v1/pbs/p1/jobs/${kind}/job-1`],
      ])),
      ...Object.fromEntries(['sync', 'verify', 'tape', 'gc'].map(kind => [`pbs-job-${kind}-run`, `/api/v1/pbs/p1/jobs/${kind}/job-1/run`])),
      'gfr-probe': '/api/v1/guest-file-restore/probe',
      'gfr-jobs-list': '/api/v1/guest-file-restore/jobs',
      'gfr-job-create': '/api/v1/guest-file-restore/jobs',
      'gfr-job-cancel': '/api/v1/guest-file-restore/jobs/j1/cancel',
      'storage-connection-list': '/api/v1/connections/c1/storage',
      'storage-attach-pbs': '/api/v1/connections/c1/storage',
      'storage-detach': '/api/v1/connections/c1/storage/pbs-main',
      'storage-content-delete': '/api/v1/connections/c1/nodes/pve1/storage/local/content/local%3Aiso%2Fdebian.iso',
      'storage-download-url': '/api/v1/connections/c1/nodes/pve1/storage/local/download-url',
      'aplinfo-list': '/api/v1/connections/c1/nodes/pve1/aplinfo',
      'aplinfo-download': '/api/v1/connections/c1/nodes/pve1/aplinfo',
      'ha-resource-get': '/api/v1/connections/c1/ha/vm:100',
      'ha-resource-upsert': '/api/v1/connections/c1/ha/vm:100',
      'ha-resource-delete': '/api/v1/connections/c1/ha/ct:101',
      'ha-groups-list': '/api/v1/connections/c1/ha/groups',
      'ha-group-create': '/api/v1/connections/c1/ha/groups',
      'ha-group-get': '/api/v1/connections/c1/ha/groups/g1',
      'ha-group-update': '/api/v1/connections/c1/ha/groups/g1',
      'ha-group-delete': '/api/v1/connections/c1/ha/groups/g1',
      'ha-affinity-list': '/api/v1/connections/c1/ha/affinity-rules',
      'ha-affinity-create': '/api/v1/connections/c1/ha/affinity-rules',
      'ha-affinity-get': '/api/v1/connections/c1/ha/affinity-rules/keep-apart',
      'ha-affinity-update': '/api/v1/connections/c1/ha/affinity-rules/keep-apart',
      'ha-affinity-delete': '/api/v1/connections/c1/ha/affinity-rules/keep-apart',
      'ha-auto-get': '/api/v1/connections/c1/ha/auto-ha',
      'ha-auto-update': '/api/v1/connections/c1/ha/auto-ha',
      'ha-auto-sync': '/api/v1/connections/c1/ha/auto-ha/sync',
      'pools-list': '/api/v1/connections/c1/pools',
      'pool-create': '/api/v1/connections/c1/pools',
      'pool-update': '/api/v1/connections/c1/pools',
      'pool-delete': '/api/v1/connections/c1/pools',
      'node-network-list': '/api/v1/connections/c1/nodes/pve1/network',
      'node-network-create': '/api/v1/connections/c1/nodes/pve1/network',
      'node-network-apply': '/api/v1/connections/c1/nodes/pve1/network',
      'node-network-revert': '/api/v1/connections/c1/nodes/pve1/network',
      'node-iface-get': '/api/v1/connections/c1/nodes/pve1/network/vmbr0',
      'node-iface-update': '/api/v1/connections/c1/nodes/pve1/network/bond0.100',
      'node-iface-delete': '/api/v1/connections/c1/nodes/pve1/network/vmbr1',
      'sdn-apply': '/api/v1/connections/c1/sdn/apply',
      'vdc-vnets-list': '/api/v1/vdcs/vdc1/vnets',
      'vdc-vnet-create': '/api/v1/vdcs/vdc1/vnets',
      'vdc-vnet-get': '/api/v1/vdcs/vdc1/vnets/lan',
      'vdc-vnet-update': '/api/v1/vdcs/vdc1/vnets/lan',
      'vdc-vnet-delete': '/api/v1/vdcs/vdc1/vnets/dmz',
    }
    for (const entry of PUBLIC_API_ALLOWLIST) {
      const path = samplePathById[entry.id]
      expect(path, `sample path for ${entry.id}`).toBeDefined()
      const edgeMatch = matchPublicApiPath(path, entry.method)
      expect(edgeMatch.ok).toBe(true)
      expect(edgeMatch.entryId).toBe(entry.id)

      const resolvedEntry = getAllowlistEntryById(edgeMatch.entryId!)!
      expect(matchesEntry(resolvedEntry, path, entry.method)).toBe(true)
      expect(matchEntryParams(resolvedEntry, path)).toEqual(edgeMatch.params)

      for (const other of PUBLIC_API_ALLOWLIST) {
        if (other.id === entry.id) continue
        expect(matchesEntry(other, path, entry.method)).toBe(false)
      }
    }
  })
})

describe('method-aware matching', () => {
  it('matches on (method, pattern) and serves HEAD from GET', () => {
    expect(matchPublicApiPath('/api/v1/vms', 'GET').entryId).toBe('vms-list')
    expect(matchPublicApiPath('/api/v1/vms', 'HEAD').ok).toBe(true)
    expect(matchPublicApiPath('/api/v1/vms', 'POST').ok).toBe(false)
    expect(allowedMethodsForPath('/api/v1/vms')).toEqual(['GET'])
    expect(allowedMethodsForPath('/api/v1/nope')).toEqual([])
  })

  it('the VM {action} entry never swallows clone, template, unlock or migrate', () => {
    const guest = '/api/v1/connections/c1/guests/qemu/pve1/100'
    expect(matchPublicApiPath(`${guest}/start`, 'POST').entryId).toBe('vm-power')
    expect(matchPublicApiPath(`${guest}/resume`, 'POST').entryId).toBe('vm-power')
    for (const literal of ['clone', 'template', 'unlock', 'migrate']) {
      expect(matchPublicApiPath(`${guest}/${literal}`, 'POST').entryId).toBe(`vm-${literal}`)
    }
    expect(matchPublicApiPath(`${guest}/console`, 'POST').ok).toBe(false)
    expect(matchPublicApiPath(`${guest}/config`, 'POST').ok).toBe(false)
    expect(allowedMethodsForPath(`${guest}/config`).sort()).toEqual(['GET', 'PUT'])
    expect(allowedMethodsForPath(`${guest}/unlock`).sort()).toEqual(['GET', 'POST'])
  })

  it('backup-jobs/{jobId} never swallows its static sibling backup-jobs/runs', () => {
    const jobs = '/api/v1/connections/c1/backup-jobs'
    expect(matchPublicApiPath(`${jobs}/backup-1a2b`, 'GET').entryId).toBe('backup-job-get')
    for (const method of ['GET', 'PUT', 'DELETE', 'POST']) {
      expect(matchPublicApiPath(`${jobs}/runs`, method).ok, method).toBe(false)
    }
    expect(allowedMethodsForPath(`${jobs}/runs`)).toEqual([])
    // Fail closed on an escaped spelling of an excluded value, and on any escape in that segment.
    for (const spelling of ['%72uns', 'ru%6Es', 'backup%2D1']) {
      expect(matchPublicApiPath(`${jobs}/${spelling}`, 'GET').ok, spelling).toBe(false)
    }
    expect(matchPublicApiPath(`${jobs}/runs/guests`, 'POST').entryId).toBe('backup-job-guests')
  })

  it('a PBS snapshot id carries its slashes encoded in its one segment only', () => {
    const snap = '/api/v1/pbs/p1/backups/ds1%2Fvm%2F100%2F1760000000'
    expect(matchPublicApiPath(snap, 'DELETE')).toMatchObject({ entryId: 'pbs-backup-delete', params: { backupId: 'ds1%2Fvm%2F100%2F1760000000' } })
    expect(matchPublicApiPath(`${snap}/verify`, 'POST').entryId).toBe('pbs-backup-verify')
    expect(matchPublicApiPath('/api/v1/pbs/p1/backups/ds1%2F..%2Fvm%2F100%2F1', 'DELETE').ok).toBe(false)
    expect(matchPublicApiPath('/api/v1/pbs/p1%2Fx/backups/ds1%2Fvm%2F100%2F1', 'DELETE').ok).toBe(false)
  })

  it('ha/{sid} never swallows its static siblings groups, affinity-rules and auto-ha', () => {
    const ha = '/api/v1/connections/c1/ha'
    expect(matchPublicApiPath(`${ha}/vm:100`, 'POST').entryId).toBe('ha-resource-upsert')
    expect(matchPublicApiPath(`${ha}/groups`, 'GET').entryId).toBe('ha-groups-list')
    expect(matchPublicApiPath(`${ha}/affinity-rules`, 'POST').entryId).toBe('ha-affinity-create')
    expect(matchPublicApiPath(`${ha}/auto-ha`, 'GET').entryId).toBe('ha-auto-get')
    for (const sibling of ['groups', 'affinity-rules', 'auto-ha']) {
      expect(matchPublicApiPath(`${ha}/${sibling}`, 'DELETE').ok, sibling).toBe(false)
    }
    expect(matchPublicApiPath(`${ha}/auto-ha`, 'POST').ok).toBe(false)
    // An escaped spelling of a sibling, or of the sid itself, fails closed.
    for (const spelling of ['%67roups', 'auto%2Dha', 'vm%3A100']) {
      expect(matchPublicApiPath(`${ha}/${spelling}`, 'POST').ok, spelling).toBe(false)
    }
  })

  it('a storage volid carries its slash encoded in its one segment only', () => {
    const content = '/api/v1/connections/c1/nodes/pve1/storage/local/content'
    expect(matchPublicApiPath(`${content}/local%3Aiso%2Fdebian.iso`, 'DELETE'))
      .toMatchObject({ entryId: 'storage-content-delete', params: { volid: 'local%3Aiso%2Fdebian.iso' } })
    expect(matchPublicApiPath(`${content}/local%3Aiso%2F..%2Fdebian.iso`, 'DELETE').ok).toBe(false)
    expect(matchPublicApiPath(`${content}/local%3Aiso%5Cdebian.iso`, 'DELETE').ok).toBe(false)
    expect(matchPublicApiPath('/api/v1/connections/c1/nodes/pve1/storage/lo%2Fcal/content/local%3Aiso%2Fdebian.iso', 'DELETE').ok).toBe(false)
  })

  it('matchesEntry checks the method and isWriteEntry flags non-GET', () => {
    const vms = getAllowlistEntryById('vms-list')!
    expect(matchesEntry(vms, '/api/v1/vms', 'HEAD')).toBe(true)
    expect(matchesEntry(vms, '/api/v1/vms', 'DELETE')).toBe(false)
    expect(isWriteEntry(vms)).toBe(false)
    expect(isWriteEntry({ ...vms, method: 'POST' })).toBe(true)
  })
})

describe('segmentEnum and encodedSlashSegment (synthetic entries)', () => {
  const base = { requiredScopes: [] as string[], tag: 'VMs', routeFile: 'x', summary: 's', description: 'd', responseSchemaRef: 'R' } as const
  const entry = (e: Partial<AllowlistEntry> & Pick<AllowlistEntry, 'id' | 'method' | 'pattern'>): AllowlistEntry => ({ ...base, ...e })

  it('segmentEnum keeps {action} from swallowing a sibling literal', () => {
    const entries = [
      entry({ id: 'act', method: 'POST', pattern: '/x/{action}', segmentEnum: { action: ['start'] } }),
      entry({ id: 'clone', method: 'POST', pattern: '/x/clone' }),
    ]
    expect(_matchAgainst(entries, '/x/clone', 'POST').entryId).toBe('clone')
    expect(_matchAgainst(entries, '/x/start', 'POST').entryId).toBe('act')
    expect(_matchAgainst(entries, '/x/other', 'POST').ok).toBe(false)
  })

  it('lifts the encoded-slash refusal for the declared segment only', () => {
    const entries = [entry({ id: 'y', method: 'GET', pattern: '/y/{a}/{b}', encodedSlashSegment: 'b' })]
    expect(_matchAgainst(entries, '/y/1/s%2Fns%2Fvm', 'GET')).toEqual({ ok: true, entryId: 'y', params: { a: '1', b: 's%2Fns%2Fvm' } })
    expect(_matchAgainst(entries, '/y/1%2F2/s', 'GET').ok).toBe(false)
    expect(_matchAgainst(entries, '/y/1/..%2Fetc', 'GET').ok).toBe(false)
    expect(_matchAgainst(entries, '/y/1/a%5Cb', 'GET').ok).toBe(false)
    expect(_matchAgainst(entries, '/y/1/a%2F%2Fb', 'GET').ok).toBe(false)
    expect(_matchAgainst(entries, '/y/1/a%2F%zz', 'GET').ok).toBe(false)
    expect(_matchAgainst(entries, '/y/1/plain', 'GET').ok).toBe(true)
  })

  it('an entry without encodedSlashSegment still rejects an encoded slash anywhere', () => {
    const entries = [entry({ id: 'z', method: 'GET', pattern: '/z/{a}' })]
    expect(_matchAgainst(entries, '/z/a%2Fb', 'GET').ok).toBe(false)
    expect(_matchAgainst(entries, '/z/a%5cb', 'GET').ok).toBe(false)
  })
})
