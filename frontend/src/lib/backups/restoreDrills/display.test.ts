import { describe, expect, it } from 'vitest'

import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  buildDrillBody,
  canCancel,
  canExportEvidence,
  canRetryCleanup,
  checkLabelKey,
  checkLook,
  cleanupBadge,
  drillDurationSec,
  cleanupGlyph,
  drillIcon,
  drillOrigin,
  drillsPollIntervalMs,
  filenameFromDisposition,
  formatDuration,
  isDrillActive,
  nodesReachingPbs,
  orderedStages,
  resultChip,
  runResultChip,
  scheduleIcon,
  scheduleScopeSummary,
  schedulesPollIntervalMs,
  secondsBetween,
  snapshotVerifyState,
  stageDurationSec,
  stageLook,
  statusChip,
} from './display'

const P = 'backups.restoreDrills'

describe('activity and polling', () => {
  it('is active while running or while its cleanup runs', () => {
    expect(isDrillActive({ status: 'queued', cleanup_state: 'none' })).toBe(true)
    expect(isDrillActive({ status: 'running', cleanup_state: 'none' })).toBe(true)
    expect(isDrillActive({ status: 'failed', cleanup_state: 'pending' })).toBe(true)
    expect(isDrillActive({ status: 'succeeded', cleanup_state: 'running' })).toBe(true)
    expect(isDrillActive({ status: 'succeeded', cleanup_state: 'done' })).toBe(false)
    expect(isDrillActive({ status: 'failed', cleanup_state: 'failed' })).toBe(false)
  })

  it('polls every 5 s with an active drill, else every 30 s', () => {
    expect(drillsPollIntervalMs(undefined)).toBe(IDLE_POLL_MS)
    expect(drillsPollIntervalMs([{ status: 'succeeded', cleanup_state: 'done' }])).toBe(IDLE_POLL_MS)
    expect(drillsPollIntervalMs([{ status: 'succeeded', cleanup_state: 'done' }, { status: 'running', cleanup_state: 'none' }])).toBe(ACTIVE_POLL_MS)
  })
})

describe('durations', () => {
  const now = Date.parse('2026-10-18T10:10:00Z')

  it('measures between two dates, or up to now', () => {
    expect(secondsBetween('2026-10-18T10:00:00Z', '2026-10-18T10:02:03Z')).toBe(123)
    expect(secondsBetween('2026-10-18T10:00:00Z', '', now)).toBe(600)
    expect(secondsBetween('', 'x')).toBeNull()
    expect(secondsBetween('0001-01-01T00:00:00Z', '')).toBeNull()
  })

  it('times a drill only once started, and live only while it runs', () => {
    expect(drillDurationSec({ status: 'queued', started_at: '', finished_at: '' }, now)).toBeNull()
    expect(drillDurationSec({ status: 'running', started_at: '2026-10-18T10:00:00Z', finished_at: '' }, now)).toBe(600)
    expect(drillDurationSec({ status: 'failed', started_at: '2026-10-18T10:00:00Z', finished_at: '' }, now)).toBeNull()
    expect(drillDurationSec({ status: 'succeeded', started_at: '2026-10-18T10:00:00Z', finished_at: '2026-10-18T10:00:45Z' }, now)).toBe(45)
  })

  it('times a stage the same way', () => {
    expect(stageDurationSec({ status: 'pending', started_at: '', ended_at: '' })).toBeNull()
    expect(stageDurationSec({ status: 'running', started_at: '2026-10-18T10:09:00Z', ended_at: '' }, now)).toBe(60)
    expect(stageDurationSec({ status: 'not_assessed', started_at: '2026-10-18T10:09:00Z', ended_at: '' }, now)).toBeNull()
    expect(stageDurationSec({ status: 'ok', started_at: '2026-10-18T10:09:00Z', ended_at: '2026-10-18T10:09:30Z' }, now)).toBe(30)
  })

  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(null)).toBe('-')
    expect(formatDuration(Number.NaN)).toBe('-')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(843)).toBe('14m 03s')
    expect(formatDuration(7500)).toBe('2h 05m')
  })
})

describe('chips and glyphs', () => {
  it('maps every status', () => {
    expect(statusChip({ status: 'queued', cancel_requested: false }).color).toBe('default')
    expect(statusChip({ status: 'running', cancel_requested: false })).toEqual({ key: `${P}.status.running`, color: 'info' })
    expect(statusChip({ status: 'running', cancel_requested: true }).key).toBe(`${P}.status.cancelling`)
    expect(statusChip({ status: 'succeeded', cancel_requested: false }).color).toBe('success')
    expect(statusChip({ status: 'failed', cancel_requested: false }).color).toBe('error')
    expect(statusChip({ status: 'cancelled', cancel_requested: false }).color).toBe('warning')
    expect(statusChip({ status: 'weird' as any, cancel_requested: false }).key).toBe(`${P}.status.queued`)
  })

  it('announces Boot verified only on that result and names the failed stage', () => {
    expect(resultChip({ result: 'boot_verified', failed_stage: '', status: 'succeeded' })).toEqual({ key: `${P}.result.bootVerified`, color: 'success' })
    expect(resultChip({ result: 'vm_started', failed_stage: '', status: 'succeeded' })).toEqual({ key: `${P}.result.vmStarted`, color: 'warning' })
    expect(resultChip({ result: 'failed', failed_stage: 'guest_started', status: 'failed' }))
      .toEqual({ key: `${P}.result.failedAt`, color: 'error', stageKey: `${P}.steps.guest_started` })
    expect(resultChip({ result: 'failed', failed_stage: '', status: 'failed' })?.key).toBe(`${P}.result.failed`)
    expect(resultChip({ result: 'cancelled', failed_stage: '', status: 'cancelled' })?.key).toBe(`${P}.result.cancelled`)
    expect(resultChip({ result: '', failed_stage: '', status: 'running' })).toBeNull()
    expect(resultChip({ result: '', failed_stage: '', status: 'succeeded' })).toBeNull()
  })

  it('badges the cleanup, red when it failed', () => {
    expect(cleanupBadge({ cleanup_state: 'failed' })).toEqual({ key: `${P}.cleanup.failed`, color: 'error' })
    expect(cleanupBadge({ cleanup_state: 'pending' })?.color).toBe('info')
    expect(cleanupBadge({ cleanup_state: 'running' })?.color).toBe('info')
    expect(cleanupBadge({ cleanup_state: 'done' })?.color).toBe('success')
    expect(cleanupBadge({ cleanup_state: 'none' })).toBeNull()
  })

  it('picks a leading glyph per outcome', () => {
    expect(drillIcon({ status: 'running', result: '' }).color).toBe('info.main')
    expect(drillIcon({ status: 'succeeded', result: 'boot_verified' }).color).toBe('success.main')
    expect(drillIcon({ status: 'succeeded', result: 'vm_started' }).color).toBe('warning.main')
    expect(drillIcon({ status: 'cancelled', result: 'cancelled' }).color).toBe('warning.main')
    expect(drillIcon({ status: 'failed', result: 'failed' }).color).toBe('error.main')
  })

  it('renders not_assessed as neutral, never as a pass', () => {
    const look = stageLook('not_assessed')
    expect(look.key).toBe(`${P}.stageStatus.not_assessed`)
    expect(look.color).toBe('text.secondary')
    expect(stageLook('ok').color).toBe('success.main')
    expect(stageLook('bogus').key).toBe(`${P}.stageStatus.pending`)
  })

  it('looks up preflight checks', () => {
    expect(checkLook('ok').color).toBe('success.main')
    expect(checkLook('warn').key).toBe(`${P}.checkStatus.warn`)
    expect(checkLook('???').key).toBe(`${P}.checkStatus.fail`)
    expect(checkLabelKey('free_space')).toBe(`${P}.checks.free_space`)
  })
})

describe('row actions', () => {
  it('offers each action in its state only', () => {
    expect(canCancel({ status: 'running', cancel_requested: false })).toBe(true)
    expect(canCancel({ status: 'running', cancel_requested: true })).toBe(false)
    expect(canCancel({ status: 'failed', cancel_requested: false })).toBe(false)
    expect(canRetryCleanup({ cleanup_state: 'failed' })).toBe(true)
    expect(canRetryCleanup({ cleanup_state: 'done' })).toBe(false)
    expect(canExportEvidence({ status: 'succeeded' })).toBe(true)
    expect(canExportEvidence({ status: 'cancelled' })).toBe(true)
    expect(canExportEvidence({ status: 'running' })).toBe(false)
  })

  it('reads the file name of the evidence', () => {
    expect(filenameFromDisposition('attachment; filename="restore-drill-1a2b3c4d-20261018-020005.json"', 'x.json'))
      .toBe('restore-drill-1a2b3c4d-20261018-020005.json')
    expect(filenameFromDisposition("attachment; filename*=UTF-8''drill%20a.json", 'x.json')).toBe('drill a.json')
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", 'x.json')).toBe('x.json')
    expect(filenameFromDisposition('attachment', 'x.json')).toBe('x.json')
    expect(filenameFromDisposition(null, 'x.json')).toBe('x.json')
  })
})

describe('stages order', () => {
  it('follows the contract order', () => {
    const st = (key: string) => ({ key, status: 'ok' as const, started_at: '', ended_at: '', detail: '' })
    expect(orderedStages([st('guest_agent'), st('extra'), st('archive_found'), st('application_check')]).map(s => s.key))
      .toEqual(['archive_found', 'guest_agent', 'application_check', 'extra'])
    expect(orderedStages(undefined)).toEqual([])
  })
})

describe('dialog body', () => {
  const backup = {
    datastore: 'store1', namespace: 'prod', backupType: 'vm', backupId: '101', backupTime: 1_792_116_005,
    backupTimeIso: '', vmName: 'web01', size: 42, verified: false, verification: { state: 'failed', 'last-run': 1_792_119_600 },
  }
  const form = {
    connId: 'c1', node: 'pve1', storage: 'local-lvm', networkMode: 'link_down' as const, bridge: 'vmbr9',
    restoreTimeoutSec: 14400, bootTimeoutSec: 600, agentTimeoutSec: 300,
  }

  it('builds the route body from the snapshot row', () => {
    expect(buildDrillBody('pbs-1', backup, form)).toEqual({
      pbsId: 'pbs-1', datastore: 'store1', namespace: 'prod', backupType: 'vm', backupId: '101',
      backupTime: new Date(1_792_116_005_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      vmName: 'web01', verifyState: 'failed', verifiedAt: new Date(1_792_119_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      backupSize: 42, targetConnectionId: 'c1', targetNode: 'pve1', targetStorage: 'local-lvm',
      networkMode: 'link_down', bridge: '', restoreTimeoutSec: 14400, bootTimeoutSec: 600, agentTimeoutSec: 300,
    })
    const bridged = buildDrillBody('pbs-1', { ...backup, backupTimeIso: '2026-10-18T02:00:05Z', verification: null, verified: true, namespace: null, size: null, vmName: null }, { ...form, networkMode: 'bridge' })
    expect(bridged).toMatchObject({ backupTime: '2026-10-18T02:00:05Z', bridge: 'vmbr9', verifyState: 'ok', verifiedAt: '', namespace: '', backupSize: 0, vmName: '' })
  })

  it('names the verification state', () => {
    expect(snapshotVerifyState({ verified: true })).toBe('ok')
    expect(snapshotVerifyState({ verification: { state: 'failed' } })).toBe('failed')
    expect(snapshotVerifyState({})).toBe('none')
  })

  it('keeps the nodes that reach the PBS storage', () => {
    const storages = [{ connId: 'c1', nodes: ['pve2'] }, { connId: 'c2', nodes: [] }]
    expect(nodesReachingPbs(['pve1', 'pve2'], storages, 'c1')).toEqual(['pve2'])
    expect(nodesReachingPbs(['a', 'b'], storages, 'c2')).toEqual(['a', 'b'])
    expect(nodesReachingPbs(['a'], storages, 'c3')).toEqual([])
  })
})

describe('queue, refusal and origin (addendum 4)', () => {
  it('shows a queued drill as waiting and a refused one as an error', () => {
    expect(drillIcon({ status: 'queued', result: '' })).toEqual({ icon: 'ri-hourglass-line', color: 'text.secondary', key: `${P}.status.queued` })
    expect(drillIcon({ status: 'refused', result: 'refused' })).toEqual({ icon: 'ri-forbid-line', color: 'error.main', key: `${P}.status.refused` })
    expect(statusChip({ status: 'refused', cancel_requested: false })).toEqual({ key: `${P}.status.refused`, color: 'error' })
    expect(resultChip({ result: 'refused', failed_stage: '', status: 'refused' })).toEqual({ key: `${P}.result.refused`, color: 'error' })
  })

  it('cancels a queued drill, exports a refused one', () => {
    expect(canCancel({ status: 'queued', cancel_requested: false })).toBe(true)
    expect(canExportEvidence({ status: 'refused' })).toBe(true)
    expect(canExportEvidence({ status: 'queued' })).toBe(false)
  })

  it('names the schedule a drill came from, null for a manual one', () => {
    expect(drillOrigin({ schedule_id: 's1', schedule_name: ' Nightly ' })).toBe('Nightly')
    expect(drillOrigin({ schedule_id: '1a2b3c4d-9999', schedule_name: '' })).toBe('1a2b3c4d')
    expect(drillOrigin({ schedule_id: '', schedule_name: '' })).toBeNull()
    expect(drillOrigin({})).toBeNull()
  })
})

describe('schedules display', () => {
  const run = (state: any, result: any) => ({ state, result })

  it('marks an enabled schedule apart from a disabled one', () => {
    expect(scheduleIcon({ enabled: true })).toEqual({ icon: 'ri-calendar-check-line', color: 'success.main', key: `${P}.schedules.enabled` })
    expect(scheduleIcon({ enabled: false }).color).toBe('text.disabled')
  })

  it('chips the last pass', () => {
    expect(runResultChip(null)).toBeNull()
    expect(runResultChip(run('done', 'ok'))).toEqual({ key: `${P}.schedules.runResult.ok`, color: 'success' })
    expect(runResultChip(run('done', 'warning'))?.color).toBe('warning')
    expect(runResultChip(run('done', 'failed'))?.color).toBe('error')
    expect(runResultChip(run('skipped', 'skipped'))?.key).toBe(`${P}.schedules.runResult.skipped`)
    expect(runResultChip(run('skipped', ''))?.key).toBe(`${P}.schedules.runResult.skipped`)
    expect(runResultChip(run('running', ''))).toEqual({ key: `${P}.schedules.runResult.running`, color: 'info' })
  })

  it('sums up the scope', () => {
    const source = { pbs_id: 'p1', pbs_name: 'PBS lab', pbs_storage: 's', datastore: 'store1', namespace: 'prod' }
    expect(scheduleScopeSummary({ scope: { mode: 'vms', vmids: [1, 2] }, source })).toEqual({ key: `${P}.schedules.scopeVms`, values: { count: 2 } })
    expect(scheduleScopeSummary({ scope: { mode: 'all', vmids: [] }, source })).toEqual({ key: `${P}.schedules.scopeAll`, values: { source: 'PBS lab / store1 / prod' } })
    expect(scheduleScopeSummary({ scope: { mode: 'all', vmids: [] }, source: { ...source, pbs_name: '', namespace: '' } }).values.source).toBe('p1 / store1')
    expect(scheduleScopeSummary({ scope: { mode: 'all' } as any, source: undefined as any }).values.source).toBe('-')
  })

  it('polls fast while a drill is active or a pass runs', () => {
    expect(schedulesPollIntervalMs(null, null)).toBe(IDLE_POLL_MS)
    expect(schedulesPollIntervalMs([{ last_run: null }], [{ status: 'running', cleanup_state: 'none' }])).toBe(ACTIVE_POLL_MS)
    expect(schedulesPollIntervalMs([{ last_run: { state: 'running' } as any }], [])).toBe(ACTIVE_POLL_MS)
    expect(schedulesPollIntervalMs([{ last_run: { state: 'done' } as any }], [{ status: 'failed', cleanup_state: 'done' }])).toBe(IDLE_POLL_MS)
  })
})

describe('cleanupGlyph', () => {
  it('draws a check once cleaned, a cross on failure, and nothing when nothing was held', () => {
    expect(cleanupGlyph({ cleanup_state: 'done' })).toEqual({ icon: 'ri-checkbox-circle-fill', color: 'success.main', key: `${P}.cleanup.done` })
    expect(cleanupGlyph({ cleanup_state: 'failed' })?.icon).toBe('ri-close-circle-fill')
    expect(cleanupGlyph({ cleanup_state: 'pending' })?.color).toBe('info.main')
    expect(cleanupGlyph({ cleanup_state: 'running' })?.icon).toBe('ri-loader-4-line')
    expect(cleanupGlyph({ cleanup_state: 'none' })).toBeNull()
  })
})
