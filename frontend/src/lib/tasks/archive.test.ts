import { describe, expect, it } from 'vitest'

import {
  ARCHIVE_MAX_WINDOW_SEC,
  TASK_FAMILIES,
  formatTaskDuration,
  matchesArchiveFilters,
  mergeArchiveTasks,
  parseArchiveQuery,
  summarizeArchive,
  taskFamily,
  taskGuestType,
  taskStatusClass,
  toArchiveTask,
  type ArchiveTask,
  type PveTaskEntry
} from './archive'

const NOW = 1_800_000_000

function entry(over: Partial<PveTaskEntry> = {}): PveTaskEntry {
  return {
    upid: 'UPID:pve1:0001:0002:6B49D200:qmstart:101:root@pam:',
    node: 'pve1',
    starttime: NOW - 120,
    endtime: NOW - 100,
    type: 'qmstart',
    id: '101',
    user: 'root@pam',
    status: 'OK',
    ...over
  }
}

function task(over: Partial<PveTaskEntry> = {}, connectionId = 'c1'): ArchiveTask {
  return toArchiveTask(entry(over), {
    connectionId,
    connectionName: `cluster-${connectionId}`,
    nowSec: NOW,
    guests: new Map([['101', { name: 'web-01', type: 'qemu', status: 'running' }]]),
    nodeStatus: new Map([['pve1', 'online']])
  })
}

describe('taskFamily', () => {
  it.each([
    ['qmstart', 'power'],
    ['vzshutdown', 'power'],
    ['startall', 'power'],
    ['qmigrate', 'migration'],
    ['vzmigrate', 'migration'],
    ['hastart', 'ha'],
    ['hamigrate', 'ha'],
    ['vzdump', 'backup'],
    ['qmrestore', 'backup'],
    ['qmsnapshot', 'snapshot'],
    ['vzrollback', 'snapshot'],
    ['aptupdate', 'other'],
    ['vncproxy', 'other']
  ])('%s is %s', (type, family) => {
    expect(taskFamily(type)).toBe(family)
  })
})

describe('taskGuestType', () => {
  it('reads the guest kind from the type prefix, vzdump excepted', () => {
    expect(taskGuestType('qmstart')).toBe('qemu')
    expect(taskGuestType('vzstart')).toBe('lxc')
    expect(taskGuestType('vzdump')).toBeNull()
    expect(taskGuestType('hastart')).toBeNull()
  })
})

describe('taskStatusClass', () => {
  it('maps PVE exit statuses', () => {
    expect(taskStatusClass(undefined)).toBe('running')
    expect(taskStatusClass('OK')).toBe('ok')
    expect(taskStatusClass('WARNINGS: 2')).toBe('warning')
    expect(taskStatusClass('command failed')).toBe('error')
  })
})

describe('parseArchiveQuery', () => {
  it('defaults to the last 24 h, every family, first page of 50', () => {
    const q = parseArchiveQuery(new URLSearchParams(), NOW)

    expect(q).toMatchObject({ since: NOW - 86400, until: NOW, status: 'all', page: 0, pageSize: 50, vmid: null, search: '' })
    expect(q.families).toEqual([...TASK_FAMILIES])
  })

  it('keeps a valid window and caps one wider than the maximum', () => {
    expect(parseArchiveQuery(new URLSearchParams({ since: String(NOW - 3600), until: String(NOW - 60) }), NOW))
      .toMatchObject({ since: NOW - 3600, until: NOW - 60 })
    expect(parseArchiveQuery(new URLSearchParams({ since: '0' }), NOW).since).toBe(NOW - ARCHIVE_MAX_WINDOW_SEC)
  })

  it('never reads past now and repairs an inverted window', () => {
    expect(parseArchiveQuery(new URLSearchParams({ until: String(NOW + 999) }), NOW).until).toBe(NOW)
    expect(parseArchiveQuery(new URLSearchParams({ since: String(NOW), until: String(NOW - 10) }), NOW))
      .toMatchObject({ since: NOW - 10 - 86400, until: NOW - 10 })
  })

  it('drops unknown families, statuses, page sizes and non numeric vmids', () => {
    const q = parseArchiveQuery(
      new URLSearchParams({ families: 'ha,bogus,backup', status: 'weird', pageSize: '7', vmid: '10a', page: '-3' }),
      NOW
    )

    expect(q).toMatchObject({ families: ['ha', 'backup'], status: 'all', pageSize: 50, vmid: null, page: 0 })
  })

  it('an empty family list selects nothing', () => {
    expect(parseArchiveQuery(new URLSearchParams({ families: '' }), NOW).families).toEqual([])
  })

  it('reads the scope filters and lowercases the search', () => {
    expect(parseArchiveQuery(new URLSearchParams({ connectionId: 'c1', node: 'pve2', vmid: ' 101 ', q: ' Web ', status: 'error', pageSize: '100' }), NOW))
      .toMatchObject({ connectionId: 'c1', node: 'pve2', vmid: '101', search: 'web', status: 'error', pageSize: 100 })
  })
})

describe('toArchiveTask', () => {
  it('attaches the guest, the node status and the duration', () => {
    expect(task()).toMatchObject({
      id: 'UPID:pve1:0001:0002:6B49D200:qmstart:101:root@pam:',
      family: 'power',
      vmid: '101',
      guestName: 'web-01',
      guestType: 'qemu',
      guestStatus: 'running',
      nodeStatus: 'online',
      statusClass: 'ok',
      durationSec: 20,
      duration: '20s',
      connectionName: 'cluster-c1'
    })
  })

  it('a running task lasts until now; a gone guest keeps its type from the task type', () => {
    const t = task({ id: '555', type: 'vzstart', endtime: undefined, status: undefined })

    expect(t).toMatchObject({ status: 'running', statusClass: 'running', durationSec: 120, endTs: null, guestName: null, guestType: 'lxc' })
  })

  it('a node level task has no guest', () => {
    expect(task({ id: '', type: 'aptupdate' })).toMatchObject({ vmid: null, guestType: null, entity: null, family: 'other' })
  })
})

describe('matchesArchiveFilters', () => {
  const base = { families: [...TASK_FAMILIES], status: 'all' as const, search: '' }

  it('filters on family, status and free text', () => {
    const t = task({ status: 'command failed' })

    expect(matchesArchiveFilters(t, base)).toBe(true)
    expect(matchesArchiveFilters(t, { ...base, families: ['backup'] })).toBe(false)
    expect(matchesArchiveFilters(t, { ...base, status: 'ok' })).toBe(false)
    expect(matchesArchiveFilters(t, { ...base, status: 'error' })).toBe(true)
    expect(matchesArchiveFilters(t, { ...base, search: 'web-0' })).toBe(true)
    expect(matchesArchiveFilters(t, { ...base, search: 'root@' })).toBe(true)
    expect(matchesArchiveFilters(t, { ...base, search: 'nothing' })).toBe(false)
  })
})

describe('mergeArchiveTasks', () => {
  it('sorts newest first and keeps one row per UPID across connections', () => {
    const older = task({ upid: 'UPID:a', starttime: NOW - 500 })
    const newer = task({ upid: 'UPID:b', starttime: NOW - 10 })
    const dupe = task({ upid: 'UPID:a', starttime: NOW - 500 }, 'c2')

    const merged = mergeArchiveTasks([dupe, older, newer])

    expect(merged.map(t => [t.id, t.connectionId])).toEqual([['UPID:b', 'c1'], ['UPID:a', 'c1']])
  })
})

describe('summarizeArchive', () => {
  it('counts each status class', () => {
    const rows = [task(), task({ status: 'WARNINGS: 1' }), task({ status: 'boom' }), task({ status: undefined, endtime: undefined })]

    expect(summarizeArchive(rows)).toEqual({ total: 4, ok: 1, warning: 1, error: 1, running: 1 })
  })
})

describe('formatTaskDuration', () => {
  it.each([
    [42, '42s'],
    [125, '2m 5s'],
    [3 * 3600 + 7 * 60, '3h 7m'],
    [2 * 86400 + 5 * 3600, '2d 5h']
  ])('%i s reads %s', (sec, text) => {
    expect(formatTaskDuration(sec)).toBe(text)
  })
})
