import { describe, expect, it } from 'vitest'

import { parsePbsUpdateOptions, PBS_REBOOT_TIMEOUT_DEFAULT, PBS_REBOOT_TIMEOUT_MAX, PBS_REBOOT_TIMEOUT_MIN } from './updateOptions'
import {
  findingTone,
  findingValues,
  isKnownFinding,
  isRunActive,
  isSubscriptionRefusal,
  needsUpdate,
  rebootState,
  runDurationSeconds,
  runOutcome,
  runPercent,
  runSteps,
  updatesTone,
  type PbsRun,
} from './updateView'

const run = (node: Record<string, unknown>, extra: Partial<PbsRun> = {}): PbsRun => ({
  id: 'r1',
  status: 'running',
  config: { auto_reboot: true, pbs: { datastore_read_only: true } },
  node_statuses: [{ node_name: 'pbs', status: 'pending', ...node } as any],
  ...extra,
})

describe('parsePbsUpdateOptions', () => {
  it('defaults to a reboot when needed, the default delay and no read-only', () => {
    expect(parsePbsUpdateOptions(undefined)).toEqual({ autoReboot: true, rebootTimeout: PBS_REBOOT_TIMEOUT_DEFAULT, datastoreReadOnly: false })
  })

  it('keeps what the dialog sends and clamps the delay', () => {
    expect(parsePbsUpdateOptions({ autoReboot: false, rebootTimeout: 5, datastoreReadOnly: true })).toEqual({
      autoReboot: false, rebootTimeout: PBS_REBOOT_TIMEOUT_MIN, datastoreReadOnly: true,
    })
    expect(parsePbsUpdateOptions({ rebootTimeout: 999999 }).rebootTimeout).toBe(PBS_REBOOT_TIMEOUT_MAX)
    expect(parsePbsUpdateOptions({ rebootTimeout: 'abc' }).rebootTimeout).toBe(PBS_REBOOT_TIMEOUT_DEFAULT)
  })

  it('only takes a literal true for read-only', () => {
    expect(parsePbsUpdateOptions({ datastoreReadOnly: 'yes' }).datastoreReadOnly).toBe(false)
  })
})

describe('findings', () => {
  it('knows its own codes and leaves the others to their message', () => {
    expect(isKnownFinding('pbs_tasks_running')).toBe(true)
    expect(isKnownFinding('pbs_dpkg_interrupted')).toBe(true)
    expect(isKnownFinding('quorum_would_be_lost')).toBe(false)
  })

  it('passes only strings and numbers to the translations', () => {
    expect(findingValues({ severity: 'error', code: 'x', message: '', context: { count: 2, tasks: 'gc', nested: { a: 1 }, none: null } })).toEqual({ count: 2, tasks: 'gc' })
    expect(findingValues({ severity: 'error', code: 'x', message: '' })).toEqual({})
  })

  it('reads a 401 on the package lists as a missing subscription', () => {
    // The two lines apt prints on a server without a subscription (lab, 23/11/2026).
    const error = "Failed to fetch https://enterprise.proxmox.com/debian/pbs/dists/trixie/InRelease  401  Unauthorized [IP: 51.91.38.34 443] The repository 'https://enterprise.proxmox.com/debian/pbs trixie InRelease' is not signed."

    expect(isSubscriptionRefusal({ severity: 'error', code: 'pbs_apt_update_failed', message: '', context: { error } })).toBe(true)
    expect(isSubscriptionRefusal({ severity: 'error', code: 'pbs_apt_update_failed', message: '', context: { error: 'Could not resolve deb.debian.org' } })).toBe(false)
    expect(isSubscriptionRefusal({ severity: 'error', code: 'pbs_tasks_running', message: '401' })).toBe(false)
  })

  it('has work to do with pending packages or an interrupted upgrade', () => {
    const updates = { updates_available: false, package_count: 0, kernel_update: false, security_updates: 0, packages: [] }

    expect(needsUpdate({ updates })).toBe(false)
    expect(needsUpdate({ updates, pending_configure: 89 })).toBe(true)
    expect(needsUpdate({ updates: { ...updates, updates_available: true } })).toBe(true)
  })
})

describe('runSteps', () => {
  it('lists every step of a run with read-only and reboot', () => {
    expect(runSteps(run({ status: 'updating' }))).toEqual([
      { step: 'maintenance', state: 'done' },
      { step: 'upgrade', state: 'active' },
      { step: 'reboot', state: 'pending' },
      { step: 'verify', state: 'pending' },
      { step: 'release', state: 'pending' },
    ])
  })

  it('leaves out the datastore steps without read-only, and the reboot when it is off', () => {
    const r = run({ status: 'updating' }, { config: { auto_reboot: false, pbs: { datastore_read_only: false } } })

    expect(runSteps(r).map(s => s.step)).toEqual(['upgrade', 'verify'])
  })

  it('shows the reboot of a finished run only when it happened', () => {
    const done = { status: 'completed' as const }

    expect(runSteps(run({ status: 'completed', did_reboot: true }, done)).map(s => s.step)).toContain('reboot')
    expect(runSteps(run({ status: 'completed', did_reboot: false }, done)).map(s => s.step)).not.toContain('reboot')
    expect(runSteps(run({ status: 'completed', did_reboot: true }, done)).every(s => s.state === 'done')).toBe(true)
  })

  it('marks the step a failed run stopped at', () => {
    const steps = runSteps(run({ status: 'failed', failed_phase: 'updating' }, { status: 'failed' }))

    expect(steps.find(s => s.step === 'maintenance')?.state).toBe('done')
    expect(steps.find(s => s.step === 'upgrade')?.state).toBe('failed')
    expect(steps.find(s => s.step === 'verify')?.state).toBe('pending')
  })

  it('handles a run that has not started, was skipped, or has no node', () => {
    expect(runSteps(run({ status: 'pending' })).every(s => s.state === 'pending')).toBe(true)
    expect(runSteps(run({ status: 'skipped' }, { status: 'completed' })).every(s => s.state === 'skipped')).toBe(true)
    expect(runSteps({ id: 'r', status: 'running', node_statuses: [] }).every(s => s.state === 'pending')).toBe(true)
  })

  it('maps both reboot phases to the reboot step', () => {
    expect(runSteps(run({ status: 'waiting_return', did_reboot: true })).find(s => s.state === 'active')?.step).toBe('reboot')
    expect(runSteps(run({ status: 'verifying_health', did_reboot: true })).find(s => s.state === 'active')?.step).toBe('verify')
    expect(runSteps(run({ status: 'exiting_maintenance', did_reboot: true })).find(s => s.state === 'active')?.step).toBe('release')
  })
})

describe('runPercent', () => {
  it('advances inside the upgrade with apt', () => {
    const at = (phase: string, done: number) => runPercent(run({ status: 'updating', package_progress: { phase, done, total: 100, updated_at: '' } }))

    expect(at('download', 50)).toBe(20)
    expect(at('unpack', 100)).toBe(30)
    expect(at('configure', 50)).toBe(35)
    expect(at('configure', 500)).toBe(40)
  })

  it('is complete for a completed run and zero before it starts', () => {
    expect(runPercent(run({ status: 'completed' }, { status: 'completed' }))).toBe(100)
    expect(runPercent(run({ status: 'pending' }))).toBe(0)
  })
})

describe('run state', () => {
  it('is active until it ends', () => {
    expect(isRunActive(run({}))).toBe(true)
    expect(isRunActive(run({}, { status: 'pending' }))).toBe(true)
    expect(isRunActive(run({}, { status: 'cancelled' }))).toBe(false)
    expect(isRunActive(null)).toBe(false)
  })

  it('measures a finished run', () => {
    expect(runDurationSeconds(run({}, { started_at: '2026-11-23T19:09:47Z', completed_at: '2026-11-23T19:13:57Z' }))).toBe(250)
    expect(runDurationSeconds(run({}, { started_at: '2026-11-23T19:09:47Z' }))).toBeNull()
    expect(runDurationSeconds(run({}, { started_at: 'x', completed_at: 'y' }))).toBeNull()
  })
})

describe('tones and outcome', () => {
  const finding = (code: string, severity: 'error' | 'warning') => ({ code, severity, message: code })

  it('reads a check row from its findings, an error first', () => {
    const findings = [finding('pbs_disk_space_low', 'warning'), finding('pbs_tasks_running', 'error')]

    expect(findingTone(findings, 'pbs_tasks_running')).toBe('error')
    expect(findingTone(findings, 'pbs_disk_space', 'pbs_disk_space_low')).toBe('warning')
    expect(findingTone(findings, 'pbs_service_inactive')).toBe('ok')
  })

  it('reads the pending updates row', () => {
    const updates = (available: boolean) => ({ updates_available: available }) as any

    expect(updatesTone({ findings: [finding('pbs_apt_update_failed', 'error')], updates: updates(false) })).toBe('error')
    expect(updatesTone({ findings: [finding('pbs_dpkg_interrupted', 'warning')], updates: updates(false) })).toBe('warning')
    expect(updatesTone({ findings: [], updates: updates(true) })).toBe('info')
    expect(updatesTone({ findings: [], updates: updates(false) })).toBe('ok')
  })

  it('names how a run ended', () => {
    const ended = (status: string, node = 'completed') => ({ id: 'r', status, node_statuses: [{ node_name: 'pbs', status: node }] }) as any

    expect(runOutcome(ended('failed'))).toEqual({ outcome: 'failed', tone: 'error' })
    expect(runOutcome(ended('cancelled'))).toEqual({ outcome: 'cancelled', tone: 'warning' })
    expect(runOutcome(ended('completed', 'skipped'))).toEqual({ outcome: 'upToDate', tone: 'info' })
    expect(runOutcome(ended('completed'))).toEqual({ outcome: 'completed', tone: 'ok' })
  })

  it('says what happened to the reboot', () => {
    expect(rebootState({ did_reboot: true, reboot_required: true })).toBe('done')
    expect(rebootState({ did_reboot: false, reboot_required: true })).toBe('pending')
    expect(rebootState({})).toBe('notNeeded')
  })
})
