import { describe, expect, it } from 'vitest'

import { actionMeta, backupSummary, bucketize, filterJournal, formatDuration, groupBursts, journalUsers, periodStart } from './journal'
import type { JournalChange } from './journal'

const change = (over: Partial<JournalChange>): JournalChange => ({
  id: 1,
  timestamp: '2026-10-26T22:05:22Z',
  resourceType: 'vm',
  resourceId: '100',
  resourceName: 'web-01',
  action: 'config_changed',
  user: 'system',
  node: 'pve1',
  connectionName: 'PVE-PROD',
  fields: [],
  ...over,
})

describe('actionMeta', () => {
  it('gives each action its family', () => {
    expect(actionMeta('backup').family).toBe('backup')
    expect(actionMeta('snapshot_deleted').family).toBe('snapshot')
    expect(actionMeta('migrated').family).toBe('migration')
  })

  it('reads an unknown action as a config change', () => {
    expect(actionMeta('something_new')).toBe(actionMeta('config_changed'))
    expect(actionMeta(undefined)).toBe(actionMeta('config_changed'))
  })
})

describe('filterJournal', () => {
  const rows = [
    change({ id: 1, action: 'backup', resourceType: 'ct', resourceId: '101', resourceName: 'debian-test', user: 'root@pam' }),
    change({ id: 2, action: 'snapshot_created', user: 'system' }),
    change({ id: 3, action: 'hardware_changed', node: 'pve3', resourceName: 'db-01', resourceId: '105' }),
  ]

  it('keeps everything without a filter', () => {
    expect(filterJournal(rows, {}).map(r => r.id)).toEqual([1, 2, 3])
  })

  it('filters on the family, not the raw action', () => {
    expect(filterJournal(rows, { family: 'snapshot' }).map(r => r.id)).toEqual([2])
    expect(filterJournal(rows, { family: 'backup' }).map(r => r.id)).toEqual([1])
  })

  it('filters on resource type and author', () => {
    expect(filterJournal(rows, { resourceType: 'ct' }).map(r => r.id)).toEqual([1])
    expect(filterJournal(rows, { user: 'system' }).map(r => r.id)).toEqual([2, 3])
  })

  it('searches id, name, node, author and cluster, ignoring case', () => {
    expect(filterJournal(rows, { search: 'DEBIAN' }).map(r => r.id)).toEqual([1])
    expect(filterJournal(rows, { search: 'pve3' }).map(r => r.id)).toEqual([3])
    expect(filterJournal(rows, { search: 'root@' }).map(r => r.id)).toEqual([1])
    expect(filterJournal(rows, { search: '105' }).map(r => r.id)).toEqual([3])
    expect(filterJournal(rows, { search: 'prod' })).toHaveLength(3)
    expect(filterJournal(rows, { search: '   ' })).toHaveLength(3)
  })

  it('combines filters', () => {
    expect(filterJournal(rows, { family: 'snapshot', user: 'root@pam' })).toEqual([])
  })
})

describe('journalUsers', () => {
  it('lists each author once, sorted, without blanks', () => {
    const rows = [change({ user: 'system' }), change({ user: 'root@pam' }), change({ user: 'system' }), change({ user: '' })]

    expect(journalUsers(rows)).toEqual(['root@pam', 'system'])
  })

  it('lists each account of a change naming several, and filters on any of them', () => {
    const rows = [change({ id: 1, user: 'ops@example.com, alice@pve' }), change({ id: 2, user: 'alice@pve' })]

    expect(journalUsers(rows)).toEqual(['alice@pve', 'ops@example.com'])
    expect(filterJournal(rows, { user: 'alice@pve' }).map(r => r.id)).toEqual([1, 2])
    expect(filterJournal(rows, { user: 'ops@example.com' }).map(r => r.id)).toEqual([1])
  })
})

describe('backupSummary', () => {
  const started = [
    { field: 'snapshots', oldValue: '', newValue: 'vzdump' },
    { field: 'parent', oldValue: '', newValue: 'vzdump' },
  ]

  const ended = [
    ...started,
    { field: 'snapshots', oldValue: 'vzdump', newValue: '' },
    { field: 'parent', oldValue: 'vzdump', newValue: '' },
  ]

  it('reads an ended OK task with its duration', () => {
    const b = backupSummary(change({
      action: 'backup', fields: ended, taskStatus: 'OK',
      taskStart: '2026-10-26T22:04:37Z', taskEnd: '2026-10-26T22:10:31Z',
    }))

    expect(b.state).toBe('ok')
    expect(b.durationSec).toBe(354)
    expect(b.status).toBe('OK')
  })

  it('reads any other end status as a failure', () => {
    const b = backupSummary(change({ action: 'backup', fields: ended, taskStatus: 'job errors', taskStart: '2026-10-26T22:04:37Z', taskEnd: '2026-10-26T22:05:00Z' }))

    expect(b.state).toBe('failed')
    expect(b.status).toBe('job errors')
  })

  it('keeps an end without a start, without a duration', () => {
    const b = backupSummary(change({ action: 'backup', fields: ended, taskStatus: 'OK', taskEnd: '2026-10-26T22:10:31Z' }))

    expect(b.state).toBe('ok')
    expect(b.durationSec).toBeUndefined()
  })

  it('is running while the snapshot is still there', () => {
    expect(backupSummary(change({ action: 'backup', fields: started, taskStart: '2026-10-26T22:04:37Z' })).state).toBe('running')
  })

  it('never claims a run once the snapshot is gone without a seen end', () => {
    expect(backupSummary(change({ action: 'backup', fields: ended, taskStart: '2026-10-26T22:04:37Z' })).state).toBe('unknown')
    expect(backupSummary(change({ action: 'backup', fields: undefined })).state).toBe('unknown')
  })
})

describe('formatDuration', () => {
  const units = { h: 'h', min: 'min', s: 's' }

  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(12, units)).toBe('12 s')
    expect(formatDuration(354, units)).toBe('5 min 54 s')
    expect(formatDuration(3720, units)).toBe('1 h 02 min')
    expect(formatDuration(0, units)).toBe('0 s')
  })
})

describe('filterJournal time range', () => {
  it('keeps from inclusive and to exclusive', () => {
    const rows = [
      change({ id: 1, timestamp: '2026-10-26T10:00:00Z' }),
      change({ id: 2, timestamp: '2026-10-26T11:00:00Z' }),
      change({ id: 3, timestamp: '2026-10-26T12:00:00Z' }),
    ]
    const at = (iso: string) => new Date(iso).getTime()

    expect(filterJournal(rows, { from: at('2026-10-26T11:00:00Z') }).map(r => r.id)).toEqual([2, 3])
    expect(filterJournal(rows, { to: at('2026-10-26T11:00:00Z') }).map(r => r.id)).toEqual([1])
    expect(filterJournal(rows, { from: at('2026-10-26T10:00:00Z'), to: at('2026-10-26T12:00:00Z') }).map(r => r.id)).toEqual([1, 2])
  })
})

describe('groupBursts', () => {
  const at = (id: number, ts: string, over: Partial<JournalChange> = {}) =>
    change({ id, timestamp: `2026-10-19T${ts}:00Z`, connectionId: 'c1', ...over })

  it('joins changes on one resource within the gap of the burst oldest change', () => {
    // r9 retries: 13:21, 13:23, then 13:51 to 14:00, all within 30 min of the previous
    const rows = [at(1, '13:21'), at(2, '13:23'), at(3, '13:51'), at(4, '13:53'), at(5, '13:58'), at(6, '14:00')]
    const entries = groupBursts(rows)

    expect(entries).toHaveLength(1)
    expect(entries[0].changes.map(c => c.id)).toEqual([6, 5, 4, 3, 2, 1])
    expect(entries[0].latest.id).toBe(6)
    expect(entries[0].earliest.id).toBe(1)
  })

  it('splits a burst on a longer gap and keeps resources apart', () => {
    const rows = [
      at(1, '10:00'),
      at(2, '10:45'),
      at(3, '10:50', { resourceId: '200' }),
      at(4, '10:55'),
    ]

    expect(groupBursts(rows).map(e => e.changes.map(c => c.id))).toEqual([[4, 2], [3], [1]])
  })

  it('keeps a backup on its own, without breaking the burst around it', () => {
    const rows = [at(1, '10:00'), at(2, '10:05', { action: 'backup' }), at(3, '10:10')]

    expect(groupBursts(rows).map(e => e.changes.map(c => c.id))).toEqual([[3, 1], [2]])
  })

  it('keeps a creation and a deletion on their own, and never bursts across them', () => {
    // 10:00 and 10:05 were the old guest, 10:10 its deletion, 10:11 the new
    // guest's creation, 10:15 and 10:20 the new guest
    const rows = [
      at(1, '10:00'), at(2, '10:05'),
      at(3, '10:10', { action: 'deleted' }), at(4, '10:11', { action: 'created' }),
      at(5, '10:15'), at(6, '10:20'),
    ]

    expect(groupBursts(rows).map(e => e.changes.map(c => c.id))).toEqual([[6, 5], [4], [3], [2, 1]])
  })

  it('tells resources of two clusters apart', () => {
    const rows = [at(1, '10:00'), at(2, '10:05', { connectionId: 'c2' })]

    expect(groupBursts(rows)).toHaveLength(2)
  })
})

describe('bucketize and periodStart', () => {
  const now = new Date(2026, 9, 27, 14, 37).getTime()
  const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString()

  it('cuts 24 h in hours, the last holding now', () => {
    const buckets = bucketize([change({ timestamp: local(27, 14, 5) }), change({ timestamp: local(27, 9, 59) })], '24h', now)

    expect(buckets).toHaveLength(24)
    expect(buckets[23].from).toBe(new Date(2026, 9, 27, 14).getTime())
    expect(buckets[23].total).toBe(1)
    expect(buckets[18].counts.config).toBe(1)
    expect(periodStart('24h', now)).toBe(buckets[0].from)
  })

  it('cuts 7 days in quarter days and 30 days in days, by family', () => {
    const week = bucketize([change({ action: 'backup', timestamp: local(27, 13) })], '7d', now)

    expect(week).toHaveLength(28)
    expect(week[27].from).toBe(new Date(2026, 9, 27, 12).getTime())
    expect(week[27].counts.backup).toBe(1)

    const month = bucketize([change({ action: 'migrated', timestamp: local(20, 8) })], '30d', now)

    expect(month).toHaveLength(30)
    expect(month[29].from).toBe(new Date(2026, 9, 27).getTime())
    expect(month[22].counts.migration).toBe(1)
  })

  it('spans all from the oldest change, by day then by week', () => {
    const days = bucketize([change({ timestamp: local(20, 8) })], 'all', now)

    expect(days).toHaveLength(8)
    expect(days[0].total).toBe(1)

    const weeks = bucketize([change({ timestamp: new Date(2026, 6, 1).toISOString() })], 'all', now)

    expect(weeks[1].to - weeks[1].from).toBe(7 * 24 * 3600 * 1000)
    expect(weeks[0].total).toBe(1)
    expect(periodStart('all', now)).toBeUndefined()
  })

  it('leaves out changes outside the period', () => {
    expect(bucketize([change({ timestamp: local(1, 8) })], '24h', now).every(b => b.total === 0)).toBe(true)
  })
})
