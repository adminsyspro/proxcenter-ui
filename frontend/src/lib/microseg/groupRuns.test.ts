import { describe, expect, it } from 'vitest'

import { groupOutcome, groupRuns } from './groupRuns'
import type { MicrosegRun } from './types'

const run = (status: MicrosegRun['status']): MicrosegRun =>
  ({ id: 'r', policy_id: 'p', kind: 'apply', status, started_at: '', duration_ms: 0, api_calls: 0, writes: 0, error: '', connection_id: 'c' })

describe('groupRuns', () => {
  it('reads the per-cluster list of a shared policy answer', () => {
    const runs = [{ connection_id: 'a', run_id: 'r1' }, { connection_id: 'b', error: 'no_client' }]
    expect(groupRuns({ run_id: 'r1', runs }, 'a')).toEqual(runs)
  })

  it('gives one entry for a legacy answer without runs', () => {
    expect(groupRuns({ run_id: 'r9' }, 'c1')).toEqual([{ connection_id: 'c1', run_id: 'r9' }])
  })
})

describe('groupOutcome', () => {
  it('is done when every run is done', () => {
    expect(groupOutcome([run('done'), run('done')])).toBe('done')
  })
  it('is partial when some failed and some are done', () => {
    expect(groupOutcome([run('done'), run('failed')])).toBe('partial')
  })
  it('is failed when every run failed', () => {
    expect(groupOutcome([run('failed'), run('failed')])).toBe('failed')
  })
  it('is failed when no run started', () => {
    expect(groupOutcome([])).toBe('failed')
  })
  it('is running while one run is running', () => {
    expect(groupOutcome([run('done'), run('running')])).toBe('running')
    expect(groupOutcome([run('failed'), run('running')])).toBe('running')
  })
})
