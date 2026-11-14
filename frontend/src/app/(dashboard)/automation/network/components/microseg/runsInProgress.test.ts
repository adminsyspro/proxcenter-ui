/** Which tracked runs still write Proxmox: the pending changes and the zones say so meanwhile. */

import { describe, expect, it } from 'vitest'

import type { TrackedRun } from './microsegTabTypes'
import { runsInProgress } from './runsInProgress'

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
