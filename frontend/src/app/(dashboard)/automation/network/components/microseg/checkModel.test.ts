import { describe, expect, it } from 'vitest'

import type { MicrosegRun, MicrosegRunResult } from '@/lib/microseg/types'

import { checkRows, findCheckCandidate, findCompanions, isCheckRun, stepLog, type CheckCompanions } from './checkModel'

const run = (id: string, kind: string, startedAt: string, over: Partial<MicrosegRun> = {}): MicrosegRun => ({
  id, policy_id: 'p1', kind, status: 'done', started_at: startedAt, duration_ms: 1000, api_calls: 0, writes: 0, error: '', ...over,
})
const result = (over: Partial<MicrosegRunResult> = {}) => ({ guests: 0, members: 0, steps: 0, drifts: 0, ...over }) as MicrosegRunResult

const READY: CheckCompanions = { ipsReady: true, ips: null, logReady: true, log: null }
const rowOf = (rows: ReturnType<typeof checkRows>, id: string) => rows.find(r => r.id === id)

describe('findCheckCandidate', () => {
  // The list is newest first.
  const runs = [
    run('log', 'log', '2026-11-03T10:00:09Z'),
    run('f2', 'full', '2026-11-03T10:00:05Z'),
    run('ips', 'ips', '2026-11-03T10:00:03Z'),
    run('f1', 'full', '2026-11-03T09:55:00Z'),
  ]

  it('takes the first full run started at or after the request time', () => {
    expect(findCheckCandidate(runs, { since: '2026-11-03T10:00:00Z', exclude: new Set() })?.id).toBe('f2')
    expect(findCheckCandidate(runs, { since: '2026-11-03T10:00:05Z', exclude: new Set() })?.id).toBe('f2')
    expect(findCheckCandidate(runs, { since: '2026-11-03T10:00:06Z', exclude: new Set() })).toBeNull()
  })

  it('compares the times, not the strings (offsets and fractions)', () => {
    expect(findCheckCandidate([run('f', 'full', '2026-11-03T11:00:05.123+01:00')], { since: '2026-11-03T10:00:00Z', exclude: new Set() })?.id).toBe('f')
  })

  it('without a request time, takes the oldest full run not excluded', () => {
    expect(findCheckCandidate(runs, { since: null, exclude: new Set(['f1']) })?.id).toBe('f2')
    expect(findCheckCandidate(runs, { since: null, exclude: new Set(['f1', 'f2']) })).toBeNull()
  })
})

describe('isCheckRun', () => {
  it('trusts the trigger of a finished run and takes a running one on its start time', () => {
    expect(isCheckRun(run('f', 'full', 'x', { result: result({ trigger: 'check' }) }))).toBe(true)
    expect(isCheckRun(run('f', 'full', 'x', { result: result() }))).toBe(false)
    expect(isCheckRun(run('f', 'full', 'x', { status: 'running', result: null }))).toBe(true)
    // The orchestrator writes an empty result for a run that has not ended: never a reason to exclude it.
    expect(isCheckRun(run('f', 'full', 'x', { status: 'running', result: {} as MicrosegRunResult }))).toBe(true)
    expect(isCheckRun(run('f', 'full', 'x', { status: 'running', result: result() }))).toBe(true)
    expect(isCheckRun(run('f', 'full', 'x', { status: 'failed', result: result({ trigger: 'check' }) }))).toBe(true)
    expect(isCheckRun(run('f', 'light', 'x'))).toBe(false)
  })
})

describe('findCompanions', () => {
  // The full run starts at 10:00:05 and lasts 4 s: the log read may start up to 10:00:24.
  const full = run('f', 'full', '2026-11-03T10:00:05Z', { duration_ms: 4000 })

  it('finds the IP collection of the minute before the full run and the log read that follows its end', () => {
    const runs = [
      run('log2', 'log', '2026-11-03T10:01:09Z'),
      run('log1', 'log', '2026-11-03T10:00:10Z'),
      full,
      run('ips1', 'ips', '2026-11-03T10:00:03Z'),
      run('ips0', 'ips', '2026-11-03T09:45:03Z'),
    ]
    expect(findCompanions(runs, full)).toEqual({ ips: runs[3], log: runs[1] })
  })

  it('never takes the runs of another tick (ips every 15 min, log every minute)', () => {
    const stale = [run('log2', 'log', '2026-11-03T10:00:25Z'), full, run('ips0', 'ips', '2026-11-03T09:59:04Z'), run('ips-1', 'ips', '2026-11-03T09:45:00Z')]
    expect(findCompanions(stale, full)).toEqual({ ips: null, log: null })
    const edges = [run('log1', 'log', '2026-11-03T10:00:24Z'), full, run('ips1', 'ips', '2026-11-03T09:59:05Z')]
    expect(findCompanions(edges, full)).toEqual({ ips: edges[2], log: edges[0] })
  })
})

describe('checkRows', () => {
  it('passes everything on a clean run and treats an absent number as 0', () => {
    const rows = checkRows(run('f', 'full', 'x', { result: result({ guests: 32, members: 32, trigger: 'check' }) }), {
      ...READY,
      ips: run('i', 'ips', 'x', { result: result({ members: 30, with_ips: 30 }) }),
    })
    expect(rows.map(r => `${r.id}:${r.status}:${r.variant}`)).toEqual([
      'inventory:pass:pass', 'ips:pass:pass', 'objects:pass:pass', 'drifts:pass:pass', 'observation:info:notMeasured',
    ])
    expect(rowOf(rows, 'inventory')?.values).toEqual({ guests: 32, members: 32 })
  })

  it('says "no new event" only for an ended log read, and in progress for one still running', () => {
    const full = run('f', 'full', 'x', { result: result({}) })
    const ended = checkRows(full, { ...READY, log: run('l', 'log', 'x', { result: result({}) }) })
    expect(rowOf(ended, 'observation')).toMatchObject({ status: 'pass', variant: 'none', values: { events: 0, suggestions: 0, dropped: 0 } })
    const running = checkRows(full, { ...READY, log: run('l', 'log', 'x', { status: 'running', result: {} as MicrosegRunResult }) })
    expect(rowOf(running, 'observation')).toMatchObject({ status: 'pending', variant: 'pending' })
  })

  it('warns on members without an IP, on writes (realigned) and on drifts', () => {
    const rows = checkRows(run('f', 'full', 'x', { writes: 3, result: result({ steps: 3, drifts: 14 }) }), {
      ...READY,
      ips: run('i', 'ips', 'x', { result: result({ members: 5, with_ips: 3 }) }),
      log: run('l', 'log', 'x', { result: result({ events: 12, suggestions: 2, dropped_foreign_dst: 4 }) }),
    })
    expect(rowOf(rows, 'ips')).toMatchObject({ status: 'warn', values: { withIps: 3, members: 5, missing: 2 } })
    expect(rowOf(rows, 'objects')).toMatchObject({ status: 'warn', values: { steps: 3, writes: 3, failed: 0 } })
    expect(rowOf(rows, 'drifts')).toMatchObject({ status: 'warn', values: { count: 14 } })
    expect(rowOf(rows, 'observation')).toMatchObject({ status: 'pass', variant: 'pass', values: { events: 12, suggestions: 2, dropped: 4 } })
  })

  it('says the IPs were not measured when the pass had no IP collection, and pending while it is looked for', () => {
    const full = run('f', 'full', 'x', { result: result({ members: 2 }) })
    expect(rowOf(checkRows(full, READY), 'ips')).toMatchObject({ status: 'info', variant: 'none' })
    const pending = checkRows(full, { ipsReady: false, ips: null, logReady: false, log: null })
    expect(rowOf(pending, 'ips')?.status).toBe('pending')
    expect(rowOf(pending, 'observation')?.status).toBe('pending')
  })

  it('adds failing rows for failed steps, unread guests, a cut run and errors', () => {
    const rows = checkRows(run('f', 'full', 'x', {
      status: 'failed',
      result: result({
        failed: [{ index: 1, kind: 'guest.tags', object: 'qemu/101', summary: 'tag web-1', error: 'locked' }],
        unread: [{ node: 'n1', type: 'qemu', vmid: 101 }],
        held: true,
        errors: ['read n2: timeout'],
      }),
    }), READY)
    expect(rowOf(rows, 'objects')).toMatchObject({ status: 'fail', lines: ['tag web-1: locked'] })
    expect(rowOf(rows, 'unread')).toMatchObject({ status: 'fail', values: { count: 1 }, guests: [{ node: 'n1', type: 'qemu', vmid: 101 }] })
    expect(rowOf(rows, 'truncated')).toMatchObject({ status: 'fail', variant: 'held' })
    expect(rowOf(rows, 'errors')).toMatchObject({ status: 'fail', lines: ['read n2: timeout'] })
  })
})

describe('stepLog', () => {
  it('lists the steps in plan order with their outcome', () => {
    const log = stepLog(run('f', 'full', 'x', {
      result: result({
        done: [{ index: 0, kind: 'ipset.sync', object: 'a', summary: '' }],
        failed: [{ index: 2, kind: 'guest.nic', object: 'b', summary: '', error: 'x' }],
        not_run: [{ index: 1, kind: 'guest.tags', object: 'c', summary: '' }],
      }),
    }))
    expect(log.map(s => `${s.index}:${s.outcome}`)).toEqual(['0:done', '1:notRun', '2:failed'])
    expect(stepLog(run('f', 'full', 'x', { result: null }))).toEqual([])
  })
})
