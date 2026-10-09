import { describe, expect, it } from 'vitest'

import {
  coverageSettingsFromThresholds,
  creationTimesFromTasks,
  DEFAULT_COVERAGE_SETTINGS,
  evaluateGuest,
  isJobEnabled,
  jobSelection,
  normalizeExcludeTag,
  normalizeGraceHours,
  parseMetaCtime,
  planAddGuestToJob,
  resolveBackupCoverage,
  type CoverageGuest,
  type VzdumpJob,
} from './coverage'

const guest = (vmid: string, extra: Partial<CoverageGuest> = {}): CoverageGuest => ({
  connId: 'c1',
  connectionName: 'Cluster 1',
  node: 'pve1',
  vmid,
  type: 'qemu',
  name: `vm-${vmid}`,
  status: 'running',
  template: false,
  tags: [],
  pool: null,
  ...extra,
})

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)
const hoursAgo = (h: number) => Math.floor((NOW - h * 3_600_000) / 1000)

function resolve(guests: CoverageGuest[], jobs: VzdumpJob[], opts: { settings?: Partial<typeof DEFAULT_COVERAGE_SETTINGS>; createdAt?: Map<string, number> } = {}) {
  return resolveBackupCoverage({
    guests,
    jobsByConnection: { c1: jobs },
    settings: { ...DEFAULT_COVERAGE_SETTINGS, ...opts.settings },
    now: NOW,
    createdAt: opts.createdAt,
  })
}

describe('jobSelection: PVE vzdump selection semantics', () => {
  it('all=1 selects every guest but the excluded ones', () => {
    const job = { id: 'j', all: 1, exclude: '101, 102' }
    expect(jobSelection(job, guest('100'))).toBe('selected')
    expect(jobSelection(job, guest('101'))).toBe('excluded')
    expect(jobSelection(job, guest('102'))).toBe('excluded')
  })

  it('an explicit vmid list selects only its members', () => {
    const job = { id: 'j', vmid: '100,105' }
    expect(jobSelection(job, guest('105'))).toBe('selected')
    expect(jobSelection(job, guest('106'))).toBe('not_selected')
  })

  it('a pool job selects the pool members only', () => {
    const job = { id: 'j', pool: 'prod' }
    expect(jobSelection(job, guest('100', { pool: 'prod' }))).toBe('selected')
    expect(jobSelection(job, guest('101', { pool: 'dev' }))).toBe('not_selected')
    expect(jobSelection(job, guest('102'))).toBe('not_selected')
  })

  it('pool wins over vmid, which wins over all, like get_included_guests', () => {
    expect(jobSelection({ pool: 'prod', vmid: '100', all: 1 }, guest('100'))).toBe('not_selected')
    expect(jobSelection({ vmid: '101', all: 1 }, guest('100'))).toBe('not_selected')
  })

  it('exclude only applies to an all job', () => {
    expect(jobSelection({ vmid: '100', exclude: '100' }, guest('100'))).toBe('selected')
  })

  it('a node restriction keeps only the guests on that node, whatever the mode', () => {
    expect(jobSelection({ all: 1, node: 'pve2' }, guest('100'))).toBe('other_node')
    expect(jobSelection({ all: 1, node: 'pve1' }, guest('100'))).toBe('selected')
    expect(jobSelection({ vmid: '100', node: 'pve2' }, guest('100'))).toBe('other_node')
    expect(jobSelection({ pool: 'prod', node: 'pve2' }, guest('100', { pool: 'prod' }))).toBe('other_node')
  })

  it('a job with no selection at all selects nothing', () => {
    expect(jobSelection({ id: 'empty' }, guest('100'))).toBe('not_selected')
    expect(jobSelection({ all: 0 }, guest('100'))).toBe('not_selected')
  })
})

describe('isJobEnabled', () => {
  it('treats a missing flag as enabled and 0 as disabled', () => {
    expect(isJobEnabled({})).toBe(true)
    expect(isJobEnabled({ enabled: 1 })).toBe(true)
    expect(isJobEnabled({ enabled: '1' })).toBe(true)
    expect(isJobEnabled({ enabled: 0 })).toBe(false)
    expect(isJobEnabled({ enabled: false })).toBe(false)
  })
})

describe('evaluateGuest', () => {
  it('is covered as soon as one enabled job selects the guest', () => {
    const v = evaluateGuest(guest('100'), [{ id: 'a', all: 1, exclude: '100' }, { id: 'b', vmid: '100' }])
    expect(v).toEqual({ covered: true, jobIds: ['b'] })
  })

  it('a disabled job never covers, and says so', () => {
    expect(evaluateGuest(guest('100'), [{ id: 'off', all: 1, enabled: 0 }])).toEqual({ covered: false, reason: 'disabled_job', jobIds: ['off'] })
  })

  it('reports the exclusion before a node restriction before a disabled job', () => {
    const jobs: VzdumpJob[] = [
      { id: 'off', vmid: '100', enabled: 0 },
      { id: 'n2', vmid: '100', node: 'pve2' },
      { id: 'all', all: 1, exclude: '100' },
    ]
    expect(evaluateGuest(guest('100'), jobs)).toEqual({ covered: false, reason: 'excluded', jobIds: ['all'] })
    expect(evaluateGuest(guest('100'), jobs.slice(0, 2))).toEqual({ covered: false, reason: 'other_node', jobIds: ['n2'] })
  })

  it('tells a cluster without any enabled job from a guest no job selects', () => {
    expect(evaluateGuest(guest('100'), [])).toEqual({ covered: false, reason: 'no_job', jobIds: [] })
    expect(evaluateGuest(guest('100'), [{ id: 'x', vmid: '999', enabled: 0 }])).toEqual({ covered: false, reason: 'no_job', jobIds: [] })
    expect(evaluateGuest(guest('100'), [{ id: 'x', vmid: '999' }])).toEqual({ covered: false, reason: 'not_selected', jobIds: [] })
  })
})

describe('resolveBackupCoverage', () => {
  const jobs: VzdumpJob[] = [{ id: 'all', all: 1, exclude: '101' }]

  it('lists the uncovered guests with their reason and counts the covered ones', () => {
    const r = resolve([guest('100'), guest('101')], jobs)
    expect(r.summary).toEqual({ total: 2, covered: 1, uncovered: 1, ignored: { template: 0, tag: 0, grace: 0 } })
    expect(r.uncovered.map(g => [g.vmid, g.reason, g.jobIds])).toEqual([['101', 'excluded', ['all']]])
  })

  it('ignores templates entirely', () => {
    const r = resolve([guest('101', { template: true })], jobs)
    expect(r.uncovered).toEqual([])
    expect(r.summary.total).toBe(0)
    expect(r.summary.ignored.template).toBe(1)
  })

  it('leaves out a guest carrying the exclusion tag, case-insensitively', () => {
    const r = resolve([guest('101', { tags: ['prod', 'No-Backup'] })], jobs)
    expect(r.uncovered).toEqual([])
    expect(r.summary.ignored.tag).toBe(1)
  })

  it('an empty exclusion tag disables the opt-out', () => {
    const r = resolve([guest('101', { tags: ['no-backup'] })], jobs, { settings: { excludeTag: '' } })
    expect(r.uncovered).toHaveLength(1)
  })

  it('a covered guest is covered, tag or not', () => {
    const r = resolve([guest('100', { tags: ['no-backup'] })], jobs)
    expect(r.summary.covered).toBe(1)
    expect(r.summary.ignored.tag).toBe(0)
  })

  it('holds back a guest created inside the grace period, lists it once past it', () => {
    const createdAt = new Map([['c1:101', hoursAgo(2)], ['c1:102', hoursAgo(30)]])
    const r = resolve([guest('101'), guest('102'), guest('103')], [], { createdAt })
    expect(r.summary.ignored.grace).toBe(1)
    expect(r.uncovered.map(g => [g.vmid, g.createdAt])).toEqual([['102', hoursAgo(30)], ['103', null]])
  })

  it('a grace period of 0 lists a brand new guest at once', () => {
    const createdAt = new Map([['c1:101', hoursAgo(0)]])
    const r = resolve([guest('101')], [], { createdAt, settings: { graceHours: 0 } })
    expect(r.uncovered).toHaveLength(1)
  })

  it('judges each guest against the jobs of its own connection only', () => {
    const r = resolveBackupCoverage({
      guests: [guest('100'), guest('100', { connId: 'c2' })],
      jobsByConnection: { c1: [{ id: 'all', all: 1 }] },
      settings: DEFAULT_COVERAGE_SETTINGS,
      now: NOW,
    })
    expect(r.uncovered.map(g => [g.connId, g.reason])).toEqual([['c2', 'no_job']])
  })
})

describe('settings', () => {
  it('defaults to 24 h and the no-backup tag', () => {
    expect(coverageSettingsFromThresholds(null)).toEqual({ graceHours: 24, excludeTag: 'no-backup' })
  })

  it('reads the threshold keys, an empty tag included', () => {
    expect(coverageSettingsFromThresholds({ backup_coverage_grace_hours: 0, backup_coverage_exclude_tag: '' })).toEqual({ graceHours: 0, excludeTag: '' })
    expect(coverageSettingsFromThresholds({ backup_coverage_grace_hours: 48.7, backup_coverage_exclude_tag: ' Skip ' })).toEqual({ graceHours: 48, excludeTag: 'skip' })
  })

  it('clamps the grace period and refuses a tag PVE would refuse', () => {
    expect(normalizeGraceHours(-3)).toBe(0)
    expect(normalizeGraceHours(1e9)).toBe(8760)
    expect(normalizeGraceHours('abc')).toBe(24)
    expect(normalizeExcludeTag('has space')).toBeNull()
    expect(normalizeExcludeTag('-lead')).toBeNull()
    expect(normalizeExcludeTag('ok_tag.v2+x-y')).toBe('ok_tag.v2+x-y')
    expect(coverageSettingsFromThresholds({ backup_coverage_exclude_tag: 'bad tag' }).excludeTag).toBe('no-backup')
  })
})

describe('creation time sources', () => {
  it('reads ctime from the QEMU meta property', () => {
    expect(parseMetaCtime({ meta: 'creation-qemu=9.0.2,ctime=1728468000' })).toBe(1728468000)
    expect(parseMetaCtime({ meta: 'ctime=1700000000' })).toBe(1700000000)
    expect(parseMetaCtime({ meta: 'creation-qemu=9.0.2' })).toBeNull()
    expect(parseMetaCtime({})).toBeNull()
    expect(parseMetaCtime(null)).toBeNull()
  })

  it('takes the latest create or restore task per vmid, never a clone', () => {
    const m = creationTimesFromTasks([
      { type: 'vzcreate', id: '200', starttime: 100 },
      { type: 'vzrestore', id: '200', starttime: 300 },
      { type: 'qmcreate', id: 201, starttime: 50 },
      { type: 'qmclone', id: '202', starttime: 400 },
      { type: 'vzdump', id: '203', starttime: 500 },
      { type: 'qmcreate', id: '', starttime: 10 },
    ])
    expect([...m.entries()]).toEqual([['200', 300], ['201', 50]])
    expect(creationTimesFromTasks(null).size).toBe(0)
  })
})

describe('planAddGuestToJob', () => {
  const g = { vmid: '9201', node: 'pve2' }

  it('appends to a vmid job and drops from an all job exclusions, deleting an emptied exclude', () => {
    expect(planAddGuestToJob({ vmid: '5100' }, g)).toEqual({ ok: true, set: { vmid: '5100,9201' }, remove: [], disabled: false })
    expect(planAddGuestToJob({ all: 1, exclude: '1,9201' }, g)).toEqual({ ok: true, set: { exclude: '1' }, remove: [], disabled: false })
    expect(planAddGuestToJob({ all: 1, exclude: '9201' }, g)).toEqual({ ok: true, set: {}, remove: ['exclude'], disabled: false })
  })

  it('refuses pool jobs, other-node jobs, jobs already selecting the guest and empty jobs', () => {
    expect(planAddGuestToJob({ pool: 'p', vmid: '1' }, g)).toEqual({ ok: false, reason: 'pool' })
    expect(planAddGuestToJob({ vmid: '1', node: 'pve1' }, g)).toEqual({ ok: false, reason: 'other_node' })
    expect(planAddGuestToJob({ vmid: '1,9201' }, g)).toEqual({ ok: false, reason: 'already' })
    expect(planAddGuestToJob({ all: 1 }, g)).toEqual({ ok: false, reason: 'already' })
    expect(planAddGuestToJob({}, g)).toEqual({ ok: false, reason: 'no_selection' })
  })

  it('flags a disabled job, and accepts a job pinned to the guest node', () => {
    expect(planAddGuestToJob({ vmid: '1', enabled: 0 }, g)).toMatchObject({ ok: true, disabled: true })
    expect(planAddGuestToJob({ vmid: '1', node: 'pve2' }, g)).toMatchObject({ ok: true })
  })
})
