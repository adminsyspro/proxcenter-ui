// @vitest-environment jsdom
/** Which tracked runs still write Proxmox: the pending changes and the zones say so meanwhile. */

import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import type { TrackedRun } from './microsegTabTypes'
import { runsInProgress, startedRuns, useTrackedRuns } from './runsInProgress'

const run = (runId: string, kind: string, zoneId?: string): TrackedRun => ({ runId, kind, label: runId, runningText: runId, zoneId })

describe('runsInProgress', () => {
  it('is idle with no run', () => {
    expect(runsInProgress([], new Set())).toEqual({ applying: false, zones: new Set() })
  })

  it('counts a zone state change, a plan, a restore and a removal as writing', () => {
    for (const kind of ['zoneState', 'apply', 'restore', 'remove']) {
      expect(runsInProgress([run('r1', kind)], new Set()).applying).toBe(true)
    }
  })

  it('does not count a check, which applies no draft', () => {
    expect(runsInProgress([run('r1', 'check')], new Set()).applying).toBe(false)
  })

  it('names the zones whose state is being written', () => {
    const got = runsInProgress([run('r1', 'zoneState', 'zw'), run('r2', 'apply'), run('r3', 'zoneState', 'zd')], new Set())
    expect([...got.zones].sort()).toEqual(['zd', 'zw'])
  })

  it('forgets a run that ended, even while its line lingers in the strip', () => {
    const runs = [run('r1', 'zoneState', 'zw'), run('r2', 'zoneState', 'zd')]
    const got = runsInProgress(runs, new Set(['r1']))
    expect(got.applying).toBe(true)
    expect([...got.zones]).toEqual(['zd'])
    expect(runsInProgress(runs, new Set(['r1', 'r2']))).toEqual({ applying: false, zones: new Set() })
  })
})

describe('startedRuns', () => {
  it('keeps the answer of one cluster as the run of the tab, as before the shared policies', () => {
    expect(startedRuns({ run_id: 'r1' }, 'c1')).toEqual({ runId: 'r1' })
    expect(startedRuns({ run_id: 'r1', runs: [{ connection_id: 'c1', run_id: 'r1' }] }, 'c1')).toEqual({ runId: 'r1' })
  })

  it('gives the run of each cluster, keyed by the run of the tab', () => {
    const runs = [{ connection_id: 'c1', run_id: 'r1' }, { connection_id: 'c2', error: 'no_client' }]
    expect(startedRuns({ run_id: 'r1', runs }, 'c1')).toEqual({ runId: 'r1', runs })
  })

  it('keys the line by the first run that started when the tab cluster has none, or by the clusters when none did', () => {
    const one = [{ connection_id: 'c1', error: 'engine_stopped' }, { connection_id: 'c2', run_id: 'r2' }]
    expect(startedRuns({ run_id: '', runs: one }, 'c1').runId).toBe('r2')
    const none = [{ connection_id: 'c1', error: 'stopped' }]
    expect(startedRuns({ run_id: '', runs: none }, 'c1')).toEqual({ runId: 'c1:stopped', runs: none })
  })
})

describe('useTrackedRuns', () => {
  it('does not follow twice a run already followed as one cluster of a group line', () => {
    const { result } = renderHook(() => useTrackedRuns())
    act(() => result.current.startRun({ ...run('r1', 'apply'), runs: [{ connection_id: 'c1', run_id: 'r1' }, { connection_id: 'c2', run_id: 'r2' }] }))
    act(() => result.current.startRun(run('r2', 'apply')))
    act(() => result.current.startRun(run('r3', 'apply')))
    expect(result.current.runs.map(r => r.runId)).toEqual(['r1', 'r3'])
  })
})
