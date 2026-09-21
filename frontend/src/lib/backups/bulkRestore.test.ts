import { describe, expect, it } from 'vitest'

import {
  buildRestoreRequest,
  composeGuestName,
  filterGuestsByVmidRange,
  groupBackupsByGuest,
  guestKey,
  isTerminal,
  planTargets,
  restorePathFor,
  selectNextJobs,
  statusFromTask,
  summarizeJobs,
  type GuestBackupGroup,
  type RawBackupRow,
  type RestoreJob,
} from './bulkRestore'

function row(over: Partial<RawBackupRow> = {}): RawBackupRow {
  return {
    id: `snap-${Math.random()}`,
    datastore: 'ds1',
    namespace: '',
    backupType: 'vm',
    backupId: '100',
    vmName: 'web-01',
    backupTime: 1_700_000_000,
    backupTimeFormatted: '2023-11-14 22:13',
    backupTimeIso: '2023-11-14T22:13:20Z',
    size: 1024,
    sizeFormatted: '1 KiB',
    verified: true,
    protected: false,
    ...over,
  }
}

function guest(over: Partial<GuestBackupGroup> = {}): GuestBackupGroup {
  const vmid = over.vmid ?? 100
  return {
    key: guestKey('ds1', '', 'vm', vmid),
    datastore: 'ds1',
    namespace: '',
    backupType: 'vm',
    vmid,
    vmName: `vm-${vmid}`,
    points: [
      {
        id: `p-${vmid}-new`,
        backupTime: 200,
        backupTimeFormatted: 'new',
        backupTimeIso: '2026-02-02T00:00:00Z',
        size: 2,
        sizeFormatted: '2 B',
        verified: true,
        protected: false,
      },
      {
        id: `p-${vmid}-old`,
        backupTime: 100,
        backupTimeFormatted: 'old',
        backupTimeIso: '2026-01-01T00:00:00Z',
        size: 1,
        sizeFormatted: '1 B',
        verified: false,
        protected: false,
      },
    ],
    ...over,
  }
}

describe('groupBackupsByGuest', () => {
  it('folds snapshots of the same guest into one entry, newest point first', () => {
    const groups = groupBackupsByGuest([
      row({ backupTime: 100, backupTimeIso: 'iso-old' }),
      row({ backupTime: 300, backupTimeIso: 'iso-new' }),
      row({ backupTime: 200, backupTimeIso: 'iso-mid' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].vmid).toBe(100)
    expect(groups[0].points.map(p => p.backupTimeIso)).toEqual(['iso-new', 'iso-mid', 'iso-old'])
  })

  it('keeps the same VMID separate per datastore and per namespace', () => {
    const groups = groupBackupsByGuest([
      row({ datastore: 'ds1', namespace: '' }),
      row({ datastore: 'ds2', namespace: '' }),
      row({ datastore: 'ds1', namespace: 'tenant-a' }),
    ])

    expect(groups).toHaveLength(3)
  })

  it('drops host backups and rows without a usable VMID', () => {
    const groups = groupBackupsByGuest([
      row({ backupType: 'host', backupId: 'srv1' }),
      row({ backupType: 'vm', backupId: 'not-a-number' }),
      row({ backupType: 'vm', backupId: '0' }),
      row({ backupType: 'ct', backupId: '201' }),
    ])

    expect(groups.map(g => `${g.backupType}/${g.vmid}`)).toEqual(['ct/201'])
  })

  it('takes the guest name from the most recent snapshot that carries one', () => {
    const groups = groupBackupsByGuest([
      row({ backupTime: 100, vmName: 'old-name' }),
      row({ backupTime: 300, vmName: 'current-name' }),
      row({ backupTime: 400, vmName: '' }),
    ])

    expect(groups[0].vmName).toBe('current-name')
  })

  it('sorts guests by VMID', () => {
    const groups = groupBackupsByGuest([row({ backupId: '310' }), row({ backupId: '105' }), row({ backupId: '200' })])

    expect(groups.map(g => g.vmid)).toEqual([105, 200, 310])
  })
})

describe('filterGuestsByVmidRange', () => {
  const guests = [guest({ vmid: 100 }), guest({ vmid: 150 }), guest({ vmid: 200 })]

  it('keeps guests inside the bounds', () => {
    expect(filterGuestsByVmidRange(guests, 120, 200).map(g => g.vmid)).toEqual([150, 200])
  })

  it('treats a null bound as open ended', () => {
    expect(filterGuestsByVmidRange(guests, null, 150).map(g => g.vmid)).toEqual([100, 150])
    expect(filterGuestsByVmidRange(guests, 150, null).map(g => g.vmid)).toEqual([150, 200])
    expect(filterGuestsByVmidRange(guests, null, null)).toHaveLength(3)
  })
})

describe('planTargets — range mode', () => {
  it('hands out the lowest free VMIDs of the range, in order', () => {
    const plan = planTargets({
      guests: [guest({ vmid: 100 }), guest({ vmid: 101 }), guest({ vmid: 102 })],
      mode: 'range',
      rangeStart: 9000,
      rangeEnd: 9100,
      usedVmIds: new Set(),
    })

    expect(plan.entries.map(e => e.targetVmid)).toEqual([9000, 9001, 9002])
    expect(plan.blockingCount).toBe(0)
  })

  it('skips VMIDs already live on the target cluster', () => {
    const plan = planTargets({
      guests: [guest({ vmid: 100 }), guest({ vmid: 101 })],
      mode: 'range',
      rangeStart: 9000,
      rangeEnd: 9100,
      usedVmIds: new Set([9000, 9001, 9002]),
    })

    expect(plan.entries.map(e => e.targetVmid)).toEqual([9003, 9004])
  })

  it('never hands the same VMID to two guests', () => {
    const plan = planTargets({
      guests: [guest({ vmid: 1 }), guest({ vmid: 2 }), guest({ vmid: 3 })],
      mode: 'range',
      rangeStart: 500,
      rangeEnd: 600,
      usedVmIds: new Set(),
    })

    const targets = plan.entries.map(e => e.targetVmid)
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('blocks the guests that no longer fit instead of truncating silently', () => {
    const plan = planTargets({
      guests: [guest({ vmid: 1 }), guest({ vmid: 2 }), guest({ vmid: 3 })],
      mode: 'range',
      rangeStart: 900,
      rangeEnd: 901,
      usedVmIds: new Set(),
    })

    expect(plan.entries.map(e => e.targetVmid)).toEqual([900, 901, null])
    expect(plan.entries[2].issue).toBe('rangeExhausted')
    expect(plan.blockingCount).toBe(1)
    expect(plan.issues).toContain('rangeExhausted')
  })

  it('rejects an incoherent or out-of-bounds range', () => {
    const inverted = planTargets({
      guests: [guest()],
      mode: 'range',
      rangeStart: 900,
      rangeEnd: 100,
      usedVmIds: new Set(),
    })
    expect(inverted.entries[0].issue).toBe('rangeInvalid')

    const tooLow = planTargets({
      guests: [guest()],
      mode: 'range',
      rangeStart: 99,
      rangeEnd: 200,
      usedVmIds: new Set(),
    })
    expect(tooLow.entries[0].issue).toBe('rangeInvalid')

    const missing = planTargets({
      guests: [guest()],
      mode: 'range',
      rangeStart: null,
      rangeEnd: null,
      usedVmIds: new Set(),
    })
    expect(missing.entries[0].issue).toBe('rangeInvalid')
    expect(missing.entries[0].blocking).toBe(true)
  })
})

describe('planTargets — source mode', () => {
  it('restores onto the original VMID when it is free', () => {
    const plan = planTargets({ guests: [guest({ vmid: 100 })], mode: 'source', usedVmIds: new Set([999]) })

    expect(plan.entries[0].targetVmid).toBe(100)
    expect(plan.entries[0].issue).toBeNull()
    expect(plan.blockingCount).toBe(0)
  })

  it('blocks a collision with a live guest unless overwrite is chosen', () => {
    const blocked = planTargets({ guests: [guest({ vmid: 100 })], mode: 'source', usedVmIds: new Set([100]) })
    expect(blocked.entries[0].issue).toBe('targetExists')
    expect(blocked.entries[0].blocking).toBe(true)

    const allowed = planTargets({
      guests: [guest({ vmid: 100 })],
      mode: 'source',
      usedVmIds: new Set([100]),
      overwrite: true,
    })
    expect(allowed.entries[0].issue).toBe('targetExists')
    expect(allowed.entries[0].blocking).toBe(false)
  })
})

describe('planTargets — restore point selection', () => {
  it('defaults to the newest point and honours an explicit choice', () => {
    const g = guest({ vmid: 100 })

    const byDefault = planTargets({ guests: [g], mode: 'source', usedVmIds: new Set() })
    expect(byDefault.entries[0].point?.id).toBe('p-100-new')

    const explicit = planTargets({
      guests: [g],
      pointByKey: { [g.key]: 'p-100-old' },
      mode: 'source',
      usedVmIds: new Set(),
    })
    expect(explicit.entries[0].point?.id).toBe('p-100-old')
  })

  it('falls back to the newest point when the chosen id no longer exists', () => {
    const g = guest({ vmid: 100 })
    const plan = planTargets({
      guests: [g],
      pointByKey: { [g.key]: 'pruned-away' },
      mode: 'source',
      usedVmIds: new Set(),
    })

    expect(plan.entries[0].point?.id).toBe('p-100-new')
  })
})

describe('buildRestoreRequest', () => {
  const plan = planTargets({
    guests: [guest({ vmid: 100 })],
    mode: 'range',
    rangeStart: 9000,
    rangeEnd: 9100,
    usedVmIds: new Set(),
  })
  const entry = plan.entries[0]

  it('targets the planned VMID with the chosen restore point', () => {
    const body = buildRestoreRequest(entry, 'pbs-1')

    expect(body).toMatchObject({
      vmid: 9000,
      type: 'qemu',
      pbsBackup: {
        pbsId: 'pbs-1',
        datastore: 'ds1',
        namespace: '',
        backupPath: 'backup/vm/100/2026-02-02T00:00:00Z',
      },
    })
    expect(body?.force).toBeUndefined()
    expect(body?.name).toBeUndefined()
  })

  it('forwards the options the wizard exposes', () => {
    const body = buildRestoreRequest(entry, 'pbs-1', {
      storage: 'local-lvm',
      bwlimit: 100_000,
      start: true,
      unique: true,
      force: true,
      nameSuffix: '-restore',
    })

    expect(body).toMatchObject({
      storage: 'local-lvm',
      bwlimit: 100_000,
      start: true,
      unique: true,
      force: true,
      name: 'vm-100-restore',
    })
  })

  it('drops a zero or negative bandwidth limit instead of sending it', () => {
    expect(buildRestoreRequest(entry, 'pbs-1', { bwlimit: 0 })?.bwlimit).toBeUndefined()
    expect(buildRestoreRequest(entry, 'pbs-1', { bwlimit: -5 })?.bwlimit).toBeUndefined()
  })

  it('sends a PVE-acceptable name, or no name at all', () => {
    const messy = planTargets({
      guests: [guest({ vmid: 100, vmName: 'e2e roadmap#6 restore test' })],
      mode: 'range',
      rangeStart: 9000,
      rangeEnd: 9100,
      usedVmIds: new Set(),
    })
    expect(buildRestoreRequest(messy.entries[0], 'pbs-1', { nameSuffix: '-r983' })?.name)
      .toBe('e2e-roadmap-6-restore-test-r983')

    const unusable = planTargets({
      guests: [guest({ vmid: 100, vmName: '###' })],
      mode: 'range',
      rangeStart: 9000,
      rangeEnd: 9100,
      usedVmIds: new Set(),
    })
    expect(buildRestoreRequest(unusable.entries[0], 'pbs-1', { nameSuffix: '###' })?.name).toBeUndefined()
  })

  it('never renames a container: PVE lxc spells it hostname and rejects name', () => {
    const ctPlan = planTargets({
      guests: [guest({ vmid: 201, backupType: 'ct' })],
      mode: 'range',
      rangeStart: 9000,
      rangeEnd: 9100,
      usedVmIds: new Set(),
    })
    const body = buildRestoreRequest(ctPlan.entries[0], 'pbs-1', { nameSuffix: '-restore' })

    expect(body?.type).toBe('lxc')
    expect(body?.name).toBeUndefined()
  })

  it('returns null for an entry that has no target or no restore point', () => {
    const exhausted = planTargets({
      guests: [guest({ vmid: 100 }), guest({ vmid: 101 })],
      mode: 'range',
      rangeStart: 900,
      rangeEnd: 900,
      usedVmIds: new Set(),
    })

    expect(buildRestoreRequest(exhausted.entries[1], 'pbs-1')).toBeNull()
    expect(buildRestoreRequest({ ...exhausted.entries[0], point: null }, 'pbs-1')).toBeNull()
  })
})

describe('composeGuestName', () => {
  it('appends the suffix when the name is already a valid DNS name', () => {
    expect(composeGuestName('web-01', '-restore')).toBe('web-01-restore')
  })

  // Measured in the lab 2026-09-21: PVE answers
  // "invalid format - value does not look like a valid DNS name" and the
  // whole restore fails, so the name has to be folded, not forwarded.
  it('folds spaces and punctuation instead of failing the restore', () => {
    expect(composeGuestName('e2e roadmap#6 restore test', '-r983')).toBe('e2e-roadmap-6-restore-test-r983')
  })

  it('keeps dotted names and never emits an empty or edge-hyphenated label', () => {
    expect(composeGuestName('srv1.lab.local', '-copy')).toBe('srv1.lab.local-copy')
    expect(composeGuestName('-weird-', '-x')).toBe('weird--x')
    expect(composeGuestName('a..b', '')).toBe('a.b')
  })

  it('truncates to one DNS label and never ends on a hyphen or a dot', () => {
    const name = composeGuestName('x'.repeat(70), '-restore')!
    expect(name.length).toBeLessThanOrEqual(63)
    expect(name.endsWith('-')).toBe(false)
    expect(name.endsWith('.')).toBe(false)
  })

  it('returns null when nothing usable is left, so no rename is sent', () => {
    expect(composeGuestName('', '')).toBeNull()
    expect(composeGuestName('###', '')).toBeNull()
    expect(composeGuestName('   ', '-x')).toBe('x')
  })
})

describe('restorePathFor', () => {
  it('builds the PBS backup path the restore route expects', () => {
    const g = guest({ vmid: 100, backupType: 'ct' })
    expect(restorePathFor(g, g.points[0])).toBe('backup/ct/100/2026-02-02T00:00:00Z')
  })
})

describe('job queue', () => {
  function job(over: Partial<RestoreJob> = {}): RestoreJob {
    return { key: `k${Math.random()}`, vmid: 100, targetVmid: 9000, label: 'vm', status: 'pending', ...over }
  }

  it('fills the free slots only', () => {
    const jobs = [
      job({ key: 'a', status: 'running' }),
      job({ key: 'b', status: 'pending' }),
      job({ key: 'c', status: 'pending' }),
    ]

    expect(selectNextJobs(jobs, 1)).toEqual([])
    expect(selectNextJobs(jobs, 2)).toEqual(['b'])
    expect(selectNextJobs(jobs, 3)).toEqual(['b', 'c'])
  })

  it('counts a starting job as active so a slot is never double booked', () => {
    const jobs = [job({ key: 'a', status: 'starting' }), job({ key: 'b', status: 'pending' })]

    expect(selectNextJobs(jobs, 1)).toEqual([])
  })

  it('never returns a terminal job', () => {
    const jobs = [job({ key: 'a', status: 'done' }), job({ key: 'b', status: 'failed' }), job({ key: 'c', status: 'cancelled' })]

    expect(selectNextJobs(jobs, 4)).toEqual([])
  })

  it('summarizes the run and reports completion only when nothing is left', () => {
    const running = summarizeJobs([job({ status: 'done' }), job({ status: 'running' }), job({ status: 'pending' })])
    expect(running).toMatchObject({ total: 3, done: 1, active: 1, pending: 1, finished: false })

    const over = summarizeJobs([job({ status: 'done' }), job({ status: 'failed' }), job({ status: 'cancelled' })])
    expect(over).toMatchObject({ done: 1, failed: 1, cancelled: 1, finished: true })
  })

  it('reports an empty run as not finished', () => {
    expect(summarizeJobs([]).finished).toBe(false)
  })

  it('knows which statuses are terminal', () => {
    expect(['done', 'failed', 'cancelled'].every(s => isTerminal(s as any))).toBe(true)
    expect(['pending', 'starting', 'running'].some(s => isTerminal(s as any))).toBe(false)
  })
})

describe('statusFromTask', () => {
  it('keeps a live task running', () => {
    expect(statusFromTask({ status: 'running' }).status).toBe('running')
  })

  it('maps a clean exit to done', () => {
    expect(statusFromTask({ status: 'stopped', exitstatus: 'OK' }).status).toBe('done')
  })

  it('maps a user interrupt to cancelled, any other exit to failed', () => {
    expect(statusFromTask({ status: 'stopped', exitstatus: 'received interrupt' }).status).toBe('cancelled')
    expect(statusFromTask({ status: 'stopped', exitstatus: 'command failed' })).toMatchObject({
      status: 'failed',
      error: 'command failed',
    })
    expect(statusFromTask({ status: 'stopped', exitstatus: null }).status).toBe('failed')
  })
})
