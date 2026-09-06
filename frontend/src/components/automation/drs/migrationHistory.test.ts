import { describe, expect, it } from 'vitest'

import {
  filterMigrations,
  formatDurationMs,
  groupByDay,
  migrationDurationMs,
  sortNewestFirst,
  summarizeMigrations,
  type MigrationHistoryEntry
} from './migrationHistory'

const entry = (over: Partial<MigrationHistoryEntry> = {}): MigrationHistoryEntry => ({
  id: 'm1',
  connection_id: 'prod',
  vmid: 100,
  vm_name: 'Debian13',
  source_node: 'pve1',
  target_node: 'pve3',
  started_at: '2026-09-06T09:50:10.000Z',
  completed_at: '2026-09-06T09:50:18.000Z',
  status: 'completed',
  ...over
})

describe('migrationDurationMs', () => {
  it('returns the elapsed milliseconds for a completed migration', () => {
    expect(migrationDurationMs(entry())).toBe(8000)
  })

  it('returns null for a running migration without a completion time', () => {
    expect(migrationDurationMs(entry({ status: 'running', completed_at: undefined }))).toBeNull()
  })

  it('returns null when completion precedes the start', () => {
    expect(migrationDurationMs(entry({ completed_at: '2026-09-06T09:50:09.000Z' }))).toBeNull()
  })

  it('returns null when the start timestamp is unparsable', () => {
    expect(migrationDurationMs(entry({ started_at: 'not-a-date' }))).toBeNull()
  })
})

describe('sortNewestFirst', () => {
  it('sorts newest first using completion time when present and start time otherwise', () => {
    const entries = [
      entry({ id: 'completed-old', completed_at: '2026-09-06T10:00:00.000Z' }),
      entry({ id: 'running-new', status: 'running', started_at: '2026-09-06T11:00:00.000Z', completed_at: null }),
      entry({ id: 'completed-newest', completed_at: '2026-09-06T12:00:00.000Z' })
    ]

    expect(sortNewestFirst(entries).map(item => item.id)).toEqual(['completed-newest', 'running-new', 'completed-old'])
  })

  it('does not mutate its input array', () => {
    const entries = [entry({ id: 'older' }), entry({ id: 'newer', completed_at: '2026-09-07T09:50:18.000Z' })]
    const original = [...entries]

    sortNewestFirst(entries)

    expect(entries).toEqual(original)
  })
})

describe('filterMigrations', () => {
  const entries = [
    entry(),
    entry({ id: 'm2', connection_id: 'dr', vmid: 9401, vm_name: 'WebServer', status: 'failed' })
  ]

  it('keeps every cluster for an empty connection id', () => {
    expect(filterMigrations(entries, { connectionId: '', status: 'all', search: '' })).toEqual(entries)
  })

  it('keeps only the selected cluster for a connection id', () => {
    expect(filterMigrations(entries, { connectionId: 'dr', status: 'all', search: '' })).toEqual([entries[1]])
  })

  it("keeps every status for the 'all' status filter", () => {
    expect(filterMigrations(entries, { connectionId: '', status: 'all', search: '' })).toHaveLength(2)
  })

  it("keeps only failed migrations for the 'failed' status filter", () => {
    expect(filterMigrations(entries, { connectionId: '', status: 'failed', search: '' })).toEqual([entries[1]])
  })

  it('matches guest names case-insensitively and VMIDs as strings', () => {
    expect(filterMigrations(entries, { connectionId: '', status: 'all', search: 'WEBSERVER' })).toEqual([entries[1]])
    expect(filterMigrations(entries, { connectionId: '', status: 'all', search: '9401' })).toEqual([entries[1]])
  })

  it('treats a search containing only spaces as empty', () => {
    expect(filterMigrations(entries, { connectionId: '', status: 'all', search: '   ' })).toEqual(entries)
  })
})

describe('groupByDay', () => {
  it('groups entries on the same local day and preserves their input order', () => {
    const first = entry({ id: 'first', started_at: new Date(2026, 8, 6, 8, 15).toISOString() })
    const second = entry({ id: 'second', started_at: new Date(2026, 8, 6, 20, 45).toISOString() })
    const groups = groupByDay([first, second])

    expect(groups).toHaveLength(1)
    expect(groups[0].entries).toEqual([first, second])
  })

  it('returns groups for different days in input order', () => {
    const later = entry({ id: 'later', started_at: new Date(2026, 8, 7, 8, 15).toISOString() })
    const earlier = entry({ id: 'earlier', started_at: new Date(2026, 8, 6, 8, 15).toISOString() })

    expect(groupByDay([later, earlier]).map(group => group.key)).toEqual(['2026-09-07', '2026-09-06'])
  })

  it("puts an unparsable start timestamp in a trailing 'unknown' group", () => {
    const valid = entry({ id: 'valid', started_at: new Date(2026, 8, 6, 8, 15).toISOString() })
    const invalid = entry({ id: 'invalid', started_at: 'not-a-date' })
    const groups = groupByDay([valid, invalid])

    expect(groups.map(group => group.key)).toEqual(['2026-09-06', 'unknown'])
    expect(groups[1].entries).toEqual([invalid])
  })

  it('sets a known group date to local midnight', () => {
    const groups = groupByDay([entry({ started_at: new Date(2026, 8, 6, 18, 30).toISOString() })])

    expect(groups[0].date).toEqual(new Date(2026, 8, 6, 0, 0))
  })
})

describe('summarizeMigrations', () => {
  it('counts statuses and averages usable durations from completed rows only', () => {
    const entries = [
      entry({ id: 'completed-8s' }),
      entry({
        id: 'completed-9s',
        started_at: '2026-09-06T09:50:10.000Z',
        completed_at: '2026-09-06T09:50:19.000Z'
      }),
      entry({ id: 'completed-invalid', completed_at: 'not-a-date' }),
      entry({ id: 'failed', status: 'failed' }),
      entry({ id: 'running', status: 'running', completed_at: null })
    ]

    expect(summarizeMigrations(entries)).toEqual({
      total: 5,
      completed: 3,
      failed: 1,
      running: 1,
      avgDurationMs: 8500
    })
  })

  it('returns zero counts and no average for empty input', () => {
    expect(summarizeMigrations([])).toEqual({ total: 0, completed: 0, failed: 0, running: 0, avgDurationMs: null })
  })
})

describe('formatDurationMs', () => {
  it("formats seconds as '8 s'", () => {
    expect(formatDurationMs(8000)).toBe('8 s')
  })

  it("formats minutes and seconds as '1 min 12 s'", () => {
    expect(formatDurationMs(72000)).toBe('1 min 12 s')
  })

  it("formats hours with zero-padded minutes as '2 h 05 min'", () => {
    expect(formatDurationMs(7500000)).toBe('2 h 05 min')
  })

  it("clamps a negative duration to '0 s'", () => {
    expect(formatDurationMs(-500)).toBe('0 s')
  })

  it('uses custom unit labels', () => {
    expect(formatDurationMs(7500000, { s: 'sec', min: 'mn', h: 'hr' })).toBe('2 hr 05 mn')
  })
})
