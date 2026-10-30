import { beforeEach, describe, expect, it, vi } from 'vitest'

const { orchestratorFetchMock } = vi.hoisted(() => ({ orchestratorFetchMock: vi.fn() }))

vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a) }))

import { fetchStoredTasks, findStoredTask, toPveEntry, upidStartTime, type StoredTask } from './history'

const START = 1_793_159_245
const UPID = `UPID:pve3-dr:000A2C4D:1168DA8B:${START.toString(16).toUpperCase()}:vzdump:101:root@pam:`

function stored(over: Partial<StoredTask> = {}): StoredTask {
  return {
    upid: UPID,
    connectionId: 'c1',
    startTime: new Date(START * 1000).toISOString(),
    endTime: new Date((START + 60) * 1000).toISOString(),
    node: 'pve3-dr',
    type: 'vzdump',
    guestId: '101',
    user: 'root@pam',
    status: 'job errors',
    ...over,
  }
}

beforeEach(() => {
  orchestratorFetchMock.mockReset()
})

describe('fetchStoredTasks', () => {
  it('asks the orchestrator for the connections, the window and the filters', async () => {
    orchestratorFetchMock.mockResolvedValue({ data: [stored()], truncated: true })

    const res = await fetchStoredTasks({ connectionIds: ['c1', 'c2'], since: 10, until: 20, nodes: ['pve1'], vmid: '101', limit: 5 })

    expect(res).toEqual({ tasks: [stored()], truncated: true })
    const [path, opts] = orchestratorFetchMock.mock.calls[0]
    const q = new URL(path, 'http://x').searchParams

    expect(path.startsWith('/task-history?')).toBe(true)
    expect(Object.fromEntries(q)).toEqual({ connectionIds: 'c1,c2', since: '10', until: '20', nodes: 'pve1', vmid: '101', limit: '5' })
    expect(opts.timeout).toBeGreaterThan(0)
  })

  it('asks nothing without a connection, and answers null when the orchestrator fails', async () => {
    expect(await fetchStoredTasks({ connectionIds: [], since: 1, until: 2 })).toEqual({ tasks: [], truncated: false })
    expect(orchestratorFetchMock).not.toHaveBeenCalled()

    vi.spyOn(console, 'error').mockImplementation(() => {})
    orchestratorFetchMock.mockRejectedValue(new Error('404'))
    expect(await fetchStoredTasks({ connectionIds: ['c1'], since: 1, until: 2 })).toBeNull()

    orchestratorFetchMock.mockResolvedValue({})
    expect(await fetchStoredTasks({ connectionIds: ['c1'], since: 1, until: 2 })).toEqual({ tasks: [], truncated: false })
  })
})

describe('toPveEntry', () => {
  it('reads a stored task the way Proxmox lists it', () => {
    expect(toPveEntry(stored())).toEqual({
      upid: UPID,
      node: 'pve3-dr',
      starttime: START,
      endtime: START + 60,
      type: 'vzdump',
      id: '101',
      user: 'root@pam',
      status: 'job errors',
    })
  })

  it('keeps a running task running and a node task without guest', () => {
    expect(toPveEntry(stored({ endTime: null, status: '', guestId: '' }))).toMatchObject({ endtime: undefined, status: undefined, id: undefined })
    expect(toPveEntry(stored({ startTime: 'nope' })).starttime).toBe(0)
  })
})

describe('upidStartTime', () => {
  it('reads the hex start of a UPID', () => {
    expect(upidStartTime(UPID)).toBe(START)
    expect(upidStartTime('UPID:pve1:1:2:zz:qmstart::root@pam:')).toBeNull()
    expect(upidStartTime('garbage')).toBeNull()
  })
})

describe('findStoredTask', () => {
  it('looks the task up on its node at its start second', async () => {
    orchestratorFetchMock.mockResolvedValue({ data: [stored({ upid: 'OTHER' }), stored()] })

    expect(await findStoredTask('c1', 'pve3-dr', UPID)).toEqual(stored())
    const q = new URL(orchestratorFetchMock.mock.calls[0][0], 'http://x').searchParams

    expect(q.get('nodes')).toBe('pve3-dr')
    expect(q.get('since')).toBe(String(START))
    expect(q.get('until')).toBe(String(START + 1))
  })

  it('answers null for a malformed UPID or a task not kept', async () => {
    expect(await findStoredTask('c1', 'pve1', 'bad')).toBeNull()
    expect(orchestratorFetchMock).not.toHaveBeenCalled()

    orchestratorFetchMock.mockResolvedValue({ data: [] })
    expect(await findStoredTask('c1', 'pve3-dr', UPID)).toBeNull()
  })
})
