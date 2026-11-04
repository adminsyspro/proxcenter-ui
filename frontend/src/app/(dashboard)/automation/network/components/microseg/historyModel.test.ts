import { describe, expect, it } from 'vitest'

import type { MicrosegRevision, MicrosegRun } from '@/lib/microseg/types'

import { historyRows, revisionDiff } from './historyModel'
import { flow, zone } from './microsegTestKit'

const rev = (version: number, at: string, zones = [zone('web')], flows = [flow('f1')]): MicrosegRevision => ({
  id: `rev-${version}`, version, author: 'ana', created_at: at, snapshot: { tag_prefix: 'zone-', zones, flows },
})
const run = (id: string, at: string): MicrosegRun => ({ id, policy_id: 'p1', kind: 'full', status: 'done', started_at: at, duration_ms: 1, api_calls: 1, writes: 0, error: '' })

describe('the history rows', () => {
  it('merges the revisions and the runs, newest first, a revision before a run of the same time', () => {
    const rows = historyRows([rev(1, '2026-11-01T10:00:00Z'), rev(2, '2026-11-02T10:00:00Z')], [run('r1', '2026-11-02T10:00:00Z'), run('r2', '2026-11-03T10:00:00Z')])
    expect(rows.map(r => r.id)).toEqual(['r2', 'rev-2', 'r1', 'rev-1'])
    expect(historyRows([rev(1, '2026-11-01T10:00:00Z')], [run('r1', '2026-11-02T10:00:00Z')], 'revisions').map(r => r.id)).toEqual(['rev-1'])
    expect(historyRows([rev(1, '2026-11-01T10:00:00Z')], [run('r1', '2026-11-02T10:00:00Z')], 'runs').map(r => r.id)).toEqual(['r1'])
  })

  it('counts what a revision added, removed and changed against the one before (zones and flows by id)', () => {
    const before = rev(1, '2026-11-01T10:00:00Z', [zone('web'), zone('old')], [flow('f1'), flow('f2')])
    const after = rev(2, '2026-11-02T10:00:00Z', [zone('web', { state: 'enforce' }), zone('db')], [flow('f1'), { ...flow('f3') }])
    expect(revisionDiff(after, before)).toEqual({ added: 2, removed: 2, changed: 1 })
    expect(revisionDiff(after, undefined)).toBeNull()
    const rows = historyRows([before, after], [])
    expect(rows[0]).toMatchObject({ type: 'revision', zones: 2, flows: 2, diff: { added: 2, removed: 2, changed: 1 } })
    expect(rows[1]).toMatchObject({ diff: null })
  })
})
