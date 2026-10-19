import { describe, expect, it } from 'vitest'

import {
  EMPTY_SCHEDULE_FORM,
  normalizeNamespace,
  parseScheduleBody,
  scheduleAuditDetails,
  scheduleFormErrors,
  scheduleFormToBody,
  scheduleToForm,
  scheduleToggleBody,
  toScheduleInput,
  vmOptionsFromSnapshots,
} from './schedules'
import { parseLimit, parseOffset } from './request'

const F = 'backups.restoreDrills.schedules.form'

const BODY = {
  name: ' Nightly ', scope: { mode: 'vms', vmids: ['101', 100] }, restore_point: 'latest',
  source: { pbs_id: 'p1', datastore: 'store1' }, connection_id: 'c1', node: 'pve1', target_storage: 'local-lvm',
  calendar: 'daily', vms_per_run: '3',
}

const SCHEDULE: any = {
  id: 's1', name: 'Nightly', enabled: false, scope: { mode: 'vms', vmids: [100, 101] }, restore_point: 'latest_verified',
  source: { pbs_id: 'p1', pbs_name: 'PBS', pbs_storage: 'pbs-prod', datastore: 'store1', namespace: 'prod' },
  connection_id: 'c1', node: 'pve1', target_storage: 'local-lvm', network_mode: 'bridge', bridge: 'vmbr9',
  calendar: 'mon..fri 02:00', vms_per_run: 2, created_by: 'a@b', rotation_last_vmid: 100, next_run_at: null, last_run: null,
  created_at: '', updated_at: '',
}

describe('parseScheduleBody', () => {
  it('normalises a valid body with defaults', () => {
    const r = parseScheduleBody(BODY)
    expect(r).toEqual({
      ok: true,
      value: {
        name: 'Nightly', enabled: true, scope: { mode: 'vms', vmids: [100, 101] }, restore_point: 'latest',
        source: { pbs_id: 'p1', datastore: 'store1', namespace: '' }, connection_id: 'c1', node: 'pve1', target_storage: 'local-lvm',
        network_mode: 'link_down', bridge: '', calendar: 'daily', vms_per_run: 3,
      },
    })
    expect(parseScheduleBody({ ...BODY, restore_point: undefined, vms_per_run: undefined, enabled: false })).toMatchObject({
      ok: true, value: { restore_point: 'latest', vms_per_run: 1, enabled: false },
    })
  })

  it('refuses what is not an object', () => {
    expect(parseScheduleBody(null)).toEqual({ ok: false, error: 'Invalid body' })
    expect(parseScheduleBody([])).toEqual({ ok: false, error: 'Invalid body' })
  })

  it('names the bad field', () => {
    expect(parseScheduleBody({ ...BODY, scope: null })).toEqual({ ok: false, error: 'scope.mode must be vms or all' })
    expect(parseScheduleBody({ ...BODY, scope: { mode: 'vms' } })).toMatchObject({ ok: false, error: expect.stringContaining('between 1 and 500') })
    expect(parseScheduleBody({ ...BODY, scope: { mode: 'vms', vmids: [0] } })).toMatchObject({ ok: false, error: 'scope.vmids must hold positive integers' })
    expect(parseScheduleBody({ ...BODY, source: { pbs_id: 'p1' } })).toEqual({ ok: false, error: 'source.datastore is required' })
    expect(parseScheduleBody({ ...BODY, connection_id: '' })).toEqual({ ok: false, error: 'connection_id is required' })
    expect(parseScheduleBody({ ...BODY, vms_per_run: 2.5 })).toMatchObject({ ok: false })
  })
})

describe('toScheduleInput', () => {
  it('adds the resolved PBS storage and the author', () => {
    const parsed = parseScheduleBody(BODY)
    if (!parsed.ok) throw new Error('unexpected')
    const input = toScheduleInput(parsed.value, { pbsName: 'PBS', pbsStorage: 'pbs-prod', createdBy: 'me@lab' })
    expect(input.source).toEqual({ pbs_id: 'p1', datastore: 'store1', namespace: '', pbs_name: 'PBS', pbs_storage: 'pbs-prod' })
    expect(input.created_by).toBe('me@lab')
    expect(scheduleAuditDetails(input)).toMatchObject({ scope: 'vms', vmids: [100, 101], pbsStorage: 'pbs-prod', calendar: 'daily' })
    expect(scheduleAuditDetails(input)).not.toHaveProperty('bridge')
  })
})

describe('schedule form', () => {
  it('lists the inline errors of an empty form', () => {
    expect(scheduleFormErrors({ ...EMPTY_SCHEDULE_FORM, calendar: '', vmsPerRun: 0 })).toEqual({
      name: `${F}.errNameRequired`, source: `${F}.errSource`, vmids: `${F}.errVmids`, target: `${F}.errTarget`,
      calendar: `${F}.errCalendar`, vmsPerRun: `${F}.errVmsPerRun`,
    })
  })

  it('checks the length, the VM count and the bridge', () => {
    const form = { ...scheduleToForm(SCHEDULE), name: 'x'.repeat(101), vmids: Array.from({ length: 501 }, (_, i) => i + 1), bridge: '' }
    expect(scheduleFormErrors(form)).toEqual({ name: `${F}.errNameTooLong`, vmids: `${F}.errVmidsTooMany`, bridge: `${F}.errBridge` })
    expect(scheduleFormErrors({ ...scheduleToForm(SCHEDULE), scopeMode: 'all', vmids: [] })).toEqual({})
  })

  it('round-trips a schedule into the form and back into a body', () => {
    const form = scheduleToForm(SCHEDULE)
    expect(form).toMatchObject({ pbsId: 'p1', namespace: 'prod', scopeMode: 'vms', restorePoint: 'latest_verified', networkMode: 'bridge', vmsPerRun: 2 })
    expect(scheduleFormToBody(form)).toEqual({
      name: 'Nightly', enabled: false, scope: { mode: 'vms', vmids: [100, 101] }, restore_point: 'latest_verified',
      source: { pbs_id: 'p1', datastore: 'store1', namespace: 'prod' }, connection_id: 'c1', node: 'pve1', target_storage: 'local-lvm',
      network_mode: 'bridge', bridge: 'vmbr9', calendar: 'mon..fri 02:00', vms_per_run: 2,
    })
    expect(scheduleFormToBody({ ...form, scopeMode: 'all', networkMode: 'link_down' })).toMatchObject({ scope: { mode: 'all', vmids: [] }, bridge: '' })
    expect(scheduleToggleBody(SCHEDULE, true).enabled).toBe(true)
  })

  it('reads a sparse schedule with safe defaults', () => {
    expect(scheduleToForm({ id: 'x' } as any)).toMatchObject({ name: '', scopeMode: 'vms', vmids: [], restorePoint: 'latest', networkMode: 'link_down', vmsPerRun: 1, calendar: '' })
    expect(scheduleToForm({ ...SCHEDULE, scope: { mode: 'all' } }).scopeMode).toBe('all')
  })
})

describe('vmOptionsFromSnapshots', () => {
  it('keeps VMs only, one per namespace, with their newest known name', () => {
    const out = vmOptionsFromSnapshots([
      { backupType: 'vm', backupId: '101', vmName: 'old', namespace: 'prod', backupTime: 1 },
      { backupType: 'vm', backupId: '101', vmName: 'web01', namespace: '/prod/', backupTime: 2 },
      { backupType: 'vm', backupId: '101', vmName: '', namespace: 'prod', backupTime: 3 },
      { backupType: 'vm', backupId: '100', vmName: null, namespace: '', backupTime: 1 },
      { backupType: 'ct', backupId: '200', vmName: 'ct', namespace: 'zz' },
      { backupType: 'vm', backupId: 'x', namespace: 'bad' },
    ])
    expect(out.namespaces).toEqual(['', 'prod'])
    expect(out.vms).toEqual([{ vmid: 100, name: '', namespace: '' }, { vmid: 101, name: 'web01', namespace: 'prod' }])
    expect(vmOptionsFromSnapshots([{ backupType: 'vm', backupId: 5, namespace: 'b' }, { backupType: 'vm', backupId: 6, namespace: 'a' }]).namespaces).toEqual(['a', 'b'])
  })

  it('normalises a namespace', () => {
    expect(normalizeNamespace(' /a/b/ ')).toBe('a/b')
    expect(normalizeNamespace(3)).toBe('')
  })
})

describe('list paging', () => {
  it('bounds limit and offset', () => {
    expect(parseLimit(null)).toBe(20)
    expect(parseLimit('0')).toBe(1)
    expect(parseLimit('500')).toBe(100)
    expect(parseLimit('x')).toBe(20)
    expect(parseOffset('40')).toBe(40)
    expect(parseOffset('-1')).toBe(0)
    expect(parseOffset(null)).toBe(0)
  })
})
