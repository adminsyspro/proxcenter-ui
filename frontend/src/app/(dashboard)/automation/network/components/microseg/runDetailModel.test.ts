import { describe, expect, it } from 'vitest'

import type { MicrosegRun, MicrosegRunResult } from '@/lib/microseg/types'

import { hasStepOutcome, runDetailRows } from './runDetailModel'

const base: MicrosegRunResult = { guests: 0, members: 0, steps: 0, drifts: 0 }
const run = (kind: string, result: Partial<MicrosegRunResult> | null = {}): MicrosegRun => ({
  id: 'r1', policy_id: 'p1', kind, status: 'done', started_at: '2026-11-04T10:00:00Z', duration_ms: 10, api_calls: 4, writes: 0, error: '',
  result: result ? { ...base, ...result } : null,
})
const keys = (r: MicrosegRun) => runDetailRows(r).map(row => row.key)

describe('runDetailRows', () => {
  it('has no line without a result', () => {
    expect(runDetailRows(run('log', null))).toEqual([])
  })

  it('counts the log lines and suggestions of a log read, the left-out events and cut logs only when there are some', () => {
    expect(runDetailRows(run('log', { events: 423, suggestions: 14 }))).toEqual([
      { key: 'events', count: 423 }, { key: 'suggestions', count: 14 },
    ])
    expect(runDetailRows(run('log', {}))).toEqual([{ key: 'events', count: 0 }, { key: 'suggestions', count: 0 }])
    expect(keys(run('log', { dropped_foreign_dst: 2, log_truncated: ['pve1', 'pve2'] }))).toEqual(['events', 'suggestions', 'droppedForeignDst', 'logTruncated'])
    expect(runDetailRows(run('log', { log_truncated: ['pve1', 'pve2'] }))[2]).toEqual({ key: 'logTruncated', text: 'pve1, pve2' })
  })

  it('counts the members with and without an IP on an IP read', () => {
    expect(runDetailRows(run('ips', { members: 33, with_ips: 33 }))).toEqual([{ key: 'members', count: 33 }, { key: 'withIps', count: 33 }])
    expect(runDetailRows(run('ips', { members: 5, with_ips: 3 }))[2]).toEqual({ key: 'withoutIp', count: 2, warn: true })
    expect(runDetailRows(run('ips', {}))).toEqual([{ key: 'members', count: 0 }, { key: 'withIps', count: 0 }])
  })

  it('tells the trigger, guests, drifts and unread or ambiguous guests of a full check', () => {
    const rows = runDetailRows(run('full', { guests: 33, members: 33, drifts: 12, trigger: 'check', unread: [{ node: 'n', type: 'lxc', vmid: 1 }], ambiguous: [{ node: 'n', type: 'lxc', vmid: 2 }] }))
    expect(rows).toEqual([
      { key: 'trigger', label: 'triggerCheck' }, { key: 'guests', count: 33 }, { key: 'members', count: 33 }, { key: 'drifts', count: 12, warn: true },
      { key: 'unread', count: 1, warn: true }, { key: 'ambiguous', count: 1, warn: true }, { key: 'steps', count: 0 },
    ])
    expect(runDetailRows(run('full', {}))[0]).toEqual({ key: 'trigger', label: 'triggerSchedule' })
    expect(runDetailRows(run('full', {}))[3]).toEqual({ key: 'drifts', count: 0, warn: false })
  })

  it('counts the corrections of a light check and the changed guests of a targeted pass', () => {
    expect(runDetailRows(run('light', { steps: 2 }))).toEqual([{ key: 'steps', count: 2 }])
    expect(keys(run('targeted', { members: 2, guests: 2, steps: 1 }))).toEqual(['members', 'guests', 'steps'])
    expect(keys(run('targeted', { unread: [{ node: 'n', type: 'qemu', vmid: 1 }] }))).toEqual(['members', 'guests', 'unread', 'steps'])
  })

  it('keeps guests, members and steps for a plan, an apply, a removal or an unknown kind', () => {
    for (const kind of ['plan', 'apply', 'remove', 'future']) {
      expect(runDetailRows(run(kind, { guests: 3, members: 2, steps: 5 }))).toEqual([
        { key: 'guests', count: 3 }, { key: 'members', count: 2 }, { key: 'steps', count: 5 },
      ])
    }
  })
})

describe('hasStepOutcome', () => {
  const step = { index: 0, kind: 'ipset.sync', object: 'pcz-web', summary: 's' }
  it('is true once a step was done, failed or not run', () => {
    expect(hasStepOutcome(run('full', {}))).toBe(false)
    expect(hasStepOutcome(run('full', null))).toBe(false)
    expect(hasStepOutcome(run('full', { done: [step] }))).toBe(true)
    expect(hasStepOutcome(run('light', { failed: [step] }))).toBe(true)
    expect(hasStepOutcome(run('apply', { not_run: [step] }))).toBe(true)
  })
})
