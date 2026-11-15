import { describe, expect, it } from 'vitest'

import type { MicrosegException, MicrosegRevision, MicrosegRun } from '@/lib/microseg/types'

import { historyRows, revisionDiff } from './historyModel'
import { exception, flow, zone } from './microsegTestKit'

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

  it('counts an outbound state or mode change of a zone as a change, and ignores the moment the observation started', () => {
    const base = rev(1, '2026-11-01T10:00:00Z', [zone('web')])
    const observe = rev(2, '2026-11-02T10:00:00Z', [zone('web', { egress_state: 'observe', egress_observe_since: '2026-11-02T10:00:00Z' })])
    const enforce = rev(3, '2026-11-03T10:00:00Z', [zone('web', { egress_state: 'enforce', egress_observe_since: '2026-11-02T10:00:00Z' })])
    const mode = rev(4, '2026-11-04T10:00:00Z', [zone('web', { egress_state: 'enforce', egress_mode: 'all', egress_observe_since: '2026-11-02T10:00:00Z' })])
    const later = rev(5, '2026-11-05T10:00:00Z', [zone('web', { egress_state: 'enforce', egress_mode: 'all', egress_observe_since: '2026-11-05T10:00:00Z' })])
    expect(revisionDiff(observe, base)).toEqual({ added: 0, removed: 0, changed: 1 })
    expect(revisionDiff(enforce, observe)).toEqual({ added: 0, removed: 0, changed: 1 })
    expect(revisionDiff(mode, enforce)).toEqual({ added: 0, removed: 0, changed: 1 })
    expect(revisionDiff(later, mode)).toEqual({ added: 0, removed: 0, changed: 0 })
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

  it('gives each revision the same diff whatever the filter', () => {
    const revs = [rev(1, '2026-11-01T10:00:00Z', [zone('web')], [flow('f1')]), rev(2, '2026-11-02T10:00:00Z', [zone('web')], [flow('f1'), flow('f2')])]
    const all = historyRows(revs, [run('r1', '2026-11-03T10:00:00Z')])
    const only = historyRows(revs, [], 'revisions')
    expect(only.map(r => (r.type === 'revision' ? r.diff : null))).toEqual(all.filter(r => r.type === 'revision').map(r => (r.type === 'revision' ? r.diff : null)))
  })
})

describe('the exceptions of a revision', () => {
  const at = '2026-11-01T10:00:00Z'
  const withExceptions = (version: number, exceptions?: MicrosegException[]): MicrosegRevision => {
    const r = rev(version, at)
    return exceptions ? { ...r, snapshot: { ...r.snapshot!, exceptions } } : r
  }
  const two = [{ type: 'qemu' as const, vmid: 200, name: 'app-01' }, { type: 'qemu' as const, vmid: 201, name: 'app-02' }]

  it('counts the exceptions a revision added and removed, by id', () => {
    expect(revisionDiff(withExceptions(2, [exception('x1')]), withExceptions(1, []))).toEqual({ added: 1, removed: 0, changed: 0 })
    expect(revisionDiff(withExceptions(2, [exception('x2')]), withExceptions(1, [exception('x1')]))).toEqual({ added: 1, removed: 1, changed: 0 })
    expect(revisionDiff(withExceptions(2, [exception('x1')]), withExceptions(1, [exception('x1')]))).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('counts a change of the sources, the destinations or the services, their order included, and not of the comment', () => {
    const before = withExceptions(1, [exception('x1', { sources: two })])
    const diff = (over: Partial<MicrosegException>) => revisionDiff(withExceptions(2, [exception('x1', { sources: two, ...over })]), before)
    expect(diff({ sources: [two[1], two[0]] })).toEqual({ added: 0, removed: 0, changed: 1 })
    expect(diff({ destinations: [{ type: 'qemu', vmid: 101, name: 'web-2' }] })).toEqual({ added: 0, removed: 0, changed: 1 })
    expect(diff({ services: [{ proto: 'tcp', dport: '22' }] })).toEqual({ added: 0, removed: 0, changed: 1 })
    expect(diff({ comment: 'why' })).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('reads a revision taken before the exceptions existed as having none', () => {
    expect(revisionDiff(withExceptions(2), withExceptions(1))).toEqual({ added: 0, removed: 0, changed: 0 })
    expect(revisionDiff(withExceptions(2, [exception('x1')]), withExceptions(1))).toEqual({ added: 1, removed: 0, changed: 0 })
    expect(revisionDiff(withExceptions(2), withExceptions(1, [exception('x1')]))).toEqual({ added: 0, removed: 1, changed: 0 })
  })
})
