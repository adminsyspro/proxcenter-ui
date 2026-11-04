import { describe, expect, it, vi, beforeEach } from 'vitest'

const { pbsFetchMock } = vi.hoisted(() => ({
  pbsFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: pbsFetchMock }))

import { fetchPbsGroupNotes, pbsSnapshotName } from './pbsGroupNotes'

const conn = { baseUrl: 'https://pbs.example', apiToken: 'x' }

beforeEach(() => {
  vi.resetAllMocks()
})

describe('fetchPbsGroupNotes', () => {
  it('reads the group list of one namespace and keys each note by type/id', async () => {
    pbsFetchMock.mockResolvedValue([
      { 'backup-type': 'vm', 'backup-id': '102', comment: 'HTC-TASKHOST' },
      { 'backup-type': 'ct', 'backup-id': '102', comment: 'web-front' },
    ])

    const notes = await fetchPbsGroupNotes(conn, 'ds 1', 'HTC/site a')

    expect(pbsFetchMock).toHaveBeenCalledWith(conn, '/admin/datastore/ds%201/groups?ns=HTC%2Fsite%20a')
    expect(notes.get('vm/102')).toBe('HTC-TASKHOST')
    expect(notes.get('ct/102')).toBe('web-front')
  })

  it('queries the root namespace without an ns parameter', async () => {
    pbsFetchMock.mockResolvedValue([])

    await fetchPbsGroupNotes(conn, 'ds1', '')

    expect(pbsFetchMock).toHaveBeenCalledWith(conn, '/admin/datastore/ds1/groups')
  })

  it('skips groups without a note, with a blank note, or without coordinates', async () => {
    pbsFetchMock.mockResolvedValue([
      { 'backup-type': 'vm', 'backup-id': '100' },
      { 'backup-type': 'vm', 'backup-id': '101', comment: '   ' },
      { 'backup-type': 'vm', comment: 'orphan' },
      { 'backup-id': '103', comment: 'orphan' },
      { 'backup-type': 'vm', 'backup-id': 104, comment: 3 },
      null,
      { 'backup-type': 'vm', 'backup-id': 105, comment: '  db-01  ' },
    ])

    const notes = await fetchPbsGroupNotes(conn, 'ds1', '')

    expect([...notes.entries()]).toEqual([['vm/105', 'db-01']])
  })

  it('returns an empty map when PBS answers with something other than a list', async () => {
    pbsFetchMock.mockResolvedValue({ unexpected: true })

    expect((await fetchPbsGroupNotes(conn, 'ds1', '')).size).toBe(0)
  })

  it('never fails the listing: a PBS error (older PBS, missing privilege, timeout) yields no notes', async () => {
    pbsFetchMock.mockRejectedValue(new Error('PBS API error 403'))

    expect((await fetchPbsGroupNotes(conn, 'ds1', 'HTC')).size).toBe(0)
  })
})

describe('pbsSnapshotName', () => {
  const groupNotes = new Map([['vm/102', 'HTC-TASKHOST']])

  it('keeps the snapshot note when there is one, even if the group has a note too', () => {
    expect(pbsSnapshotName({ 'backup-type': 'vm', 'backup-id': '102', comment: 'htc-taskhost-old' }, groupNotes))
      .toBe('htc-taskhost-old')
  })

  it('falls back to the note of the SAME group when the snapshot has none', () => {
    expect(pbsSnapshotName({ 'backup-type': 'vm', 'backup-id': '102' }, groupNotes)).toBe('HTC-TASKHOST')
    expect(pbsSnapshotName({ 'backup-type': 'vm', 'backup-id': 102, comment: '  ' }, groupNotes)).toBe('HTC-TASKHOST')
  })

  it('never borrows the note of another group: same VMID but other type, or other VMID', () => {
    expect(pbsSnapshotName({ 'backup-type': 'ct', 'backup-id': '102' }, groupNotes)).toBe('')
    expect(pbsSnapshotName({ 'backup-type': 'vm', 'backup-id': '101' }, groupNotes)).toBe('')
  })

  it('stays empty without any note, and tolerates a missing map or snapshot fields', () => {
    expect(pbsSnapshotName({ 'backup-type': 'vm', 'backup-id': '100' }, new Map())).toBe('')
    expect(pbsSnapshotName({ 'backup-type': 'vm', 'backup-id': '102' })).toBe('')
    expect(pbsSnapshotName(null, groupNotes)).toBe('')
  })
})
