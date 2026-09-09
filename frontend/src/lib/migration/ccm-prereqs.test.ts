import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock, waitForTaskMock, getReplicationJobsMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  waitForTaskMock: vi.fn(),
  getReplicationJobsMock: vi.fn(),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTask: (...a: any[]) => waitForTaskMock(...a) }))
vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({ getReplicationJobs: (...a: any[]) => getReplicationJobsMock(...a) }),
}))

import {
  applyRestorePlan,
  captureHaResource,
  captureReplicationJobs,
  deleteGuestSnapshots,
  findHaRulesForSid,
  findSiteRecoveryJobsForGuest,
  haGroupExists,
  markReplicationJobsForRemoval,
  nextReplicationJobId,
  removeHaResource,
  restoreHaResource,
  restoreReplicationJob,
  rollbackPrereqsOnSource,
  storageSupportsReplication,
  waitForReplicationJobsGone,
  type CcmPrereqCapture,
  type CcmRestorePlan,
  type HaResourceCapture,
} from './ccm-prereqs'

const CONN = { baseUrl: 'https://pve:8006', apiToken: 'test-token' }
const HA: HaResourceCapture = {
  sid: 'vm:100', state: 'started', group: 'source-group', comment: 'keep this config',
  maxRestart: 3, maxRelocate: 2, failback: 0, autoRebalance: 1,
}
const CAPTURE: CcmPrereqCapture = {
  ha: HA,
  replication: [{ id: '100-7', guest: 100, target: 'source-peer', schedule: '*/15', rate: 10, comment: 'source job', disable: 1 }],
  snapshotsDeleted: ['irreversible'],
}

function plan(overrides: Partial<CcmRestorePlan> = {}): CcmRestorePlan {
  return { capture: CAPTURE, restoreHa: true, restoreReplication: true, replicationTarget: 'target-peer', ...overrides }
}

function formBody(callIndex: number): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(pveFetchMock.mock.calls[callIndex][2].body))
}

beforeEach(() => {
  vi.resetAllMocks()
  pveFetchMock.mockResolvedValue([])
  waitForTaskMock.mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers() })

describe('storageSupportsReplication', () => {
  it.each(['zfspool', 'btrfs'])('supports %s', type => {
    expect(storageSupportsReplication(type)).toBe(true)
  })
  it.each(['rbd', 'lvmthin', 'dir', 'nfs', undefined, ''])('does not support %s', type => {
    expect(storageSupportsReplication(type)).toBe(false)
  })
})

describe('captureHaResource', () => {
  it('maps every captured field and coerces PVE numbers', async () => {
    pveFetchMock.mockResolvedValue({
      state: 'started', group: 'source-group', comment: 'keep this config',
      max_restart: '3', max_relocate: 2, failback: '0', 'auto-rebalance': '1',
    })
    expect(await captureHaResource(CONN, 'vm:100')).toEqual(HA)
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/cluster/ha/resources/vm%3A100')
  })

  it('accepts the underscore auto_rebalance alias and drops invalid or empty numbers', async () => {
    pveFetchMock.mockResolvedValue({ max_restart: 'invalid', max_relocate: '', failback: null, auto_rebalance: '0' })
    expect(await captureHaResource(CONN, 'vm:100')).toEqual({
      sid: 'vm:100', state: undefined, group: undefined, comment: undefined,
      maxRestart: undefined, maxRelocate: undefined, failback: undefined, autoRebalance: 0,
    })
  })

  it('returns null for an absent HA resource', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE 404'))
    expect(await captureHaResource(CONN, 'vm:100')).toBeNull()
  })

  it('returns null for an empty response', async () => {
    pveFetchMock.mockResolvedValue(null)
    expect(await captureHaResource(CONN, 'vm:100')).toBeNull()
  })

  it('returns null on the HTTP 500 "no such resource" PVE really answers', async () => {
    // Measured on PVE 9.2.11: an unmanaged guest gets a 500, NOT a 404. Reading
    // only the status made this throw for every guest without HA, which broke
    // the prepare route for the common case.
    pveFetchMock.mockRejectedValue(new Error(`PVE 500 /cluster/ha/resources/vm%3A100: {"data":null,"message":"no such resource 'vm:100'\n"}`))
    expect(await captureHaResource(CONN, 'vm:100')).toBeNull()
  })

  it('rethrows a genuine failure so callers cannot remove without a capture', async () => {
    const error = new Error('PVE 500 /cluster/ha/resources/vm%3A100: {"message":"permission denied"}')
    pveFetchMock.mockRejectedValue(error)
    await expect(captureHaResource(CONN, 'vm:100')).rejects.toBe(error)
  })
})

describe('findHaRulesForSid', () => {
  it('matches complete comma-separated resource ids with surrounding whitespace', async () => {
    pveFetchMock.mockResolvedValue([
      { rule: 'matching', resources: 'vm:101, vm:100 ,ct:102' },
      { rule: 'other', resources: 'vm:1000,vm:10' },
      { rule: 'empty' },
    ])
    expect(await findHaRulesForSid(CONN, 'vm:100')).toEqual(['matching'])
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/cluster/ha/rules')
  })

  it('matches arrays and legacy services/sids fields and omits nameless rules', async () => {
    pveFetchMock.mockResolvedValue([
      { rule: 'array-rule', resources: ['vm:100', 'vm:101'] },
      { id: 'services-rule', services: ['vm:100'] },
      { rule: 'sid-rule', sids: 'vm:100' },
      { resources: ['vm:100'] },
    ])
    expect(await findHaRulesForSid(CONN, 'vm:100')).toEqual(['array-rule', 'services-rule', 'sid-rule'])
  })

  it('returns no rules when PVE 8 has no endpoint', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE 404'))
    expect(await findHaRulesForSid(CONN, 'vm:100')).toEqual([])
  })

  it('returns no rules for a non-array response', async () => {
    pveFetchMock.mockResolvedValue({})
    expect(await findHaRulesForSid(CONN, 'vm:100')).toEqual([])
  })
})

describe('captureReplicationJobs', () => {
  it.each(['100', 100])('matches numeric and string guests for vmid %s, including marked jobs', async vmid => {
    pveFetchMock.mockResolvedValue([
      { id: '100-0', guest: 100, target: 'pve2', schedule: '*/15', rate: '10', comment: 'job', disable: '0', remove_job: 'full' },
      { id: '100-1', guest: '100', target: 'pve3' },
      { id: '101-0', guest: 101, target: 'pve2' },
    ])
    expect(await captureReplicationJobs(CONN, vmid)).toEqual([
      { id: '100-0', guest: 100, target: 'pve2', schedule: '*/15', rate: 10, comment: 'job', disable: 0 },
      { id: '100-1', guest: 100, target: 'pve3', schedule: undefined, rate: undefined, comment: undefined, disable: undefined },
    ])
  })

  it('returns no jobs for a non-array response', async () => {
    pveFetchMock.mockResolvedValue(null)
    expect(await captureReplicationJobs(CONN, 100)).toEqual([])
  })
})

describe('removeHaResource', () => {
  it('deletes the encoded resource sid', async () => {
    await removeHaResource(CONN, 'vm:100')
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/cluster/ha/resources/vm%3A100', { method: 'DELETE' })
  })
})

describe('markReplicationJobsForRemoval', () => {
  it.each(['PVE 404', 'no such job'])('continues after an already removed job: %s', async message => {
    pveFetchMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(undefined)
    expect(await markReplicationJobsForRemoval(CONN, ['100-0', '100-1', '100-2'])).toEqual({
      marked: ['100-0', '100-2'], alreadyGone: ['100-1'],
    })
    expect(pveFetchMock.mock.calls).toEqual([
      [CONN, '/cluster/replication/100-0', { method: 'DELETE' }],
      [CONN, '/cluster/replication/100-1', { method: 'DELETE' }],
      [CONN, '/cluster/replication/100-2', { method: 'DELETE' }],
    ])
  })

  it('rethrows a 500 and stops before the next job', async () => {
    const error = new Error('PVE 500')
    pveFetchMock.mockRejectedValue(error)
    await expect(markReplicationJobsForRemoval(CONN, ['100-0', '100-1'])).rejects.toBe(error)
    expect(pveFetchMock).toHaveBeenCalledOnce()
  })
})

describe('waitForReplicationJobsGone', () => {
  it('returns immediately without a read when there are no marked jobs', async () => {
    expect(await waitForReplicationJobsGone(CONN, [])).toEqual([])
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns immediately when only unrelated jobs remain', async () => {
    pveFetchMock.mockResolvedValue([{ id: '101-0' }])
    expect(await waitForReplicationJobsGone(CONN, ['100-0'])).toEqual([])
    expect(pveFetchMock).toHaveBeenCalledOnce()
  })

  it('stops polling as soon as the marked entries disappear', async () => {
    vi.useFakeTimers()
    pveFetchMock.mockResolvedValueOnce([{ id: '100-0' }]).mockResolvedValueOnce([])
    const result = waitForReplicationJobsGone(CONN, ['100-0'], { timeoutMs: 30, intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect(await result).toEqual([])
    expect(pveFetchMock).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns only the ids still present after the budget expires', async () => {
    vi.useFakeTimers()
    pveFetchMock.mockResolvedValue([{ id: '100-1' }, { id: '101-0' }])
    const result = waitForReplicationJobsGone(CONN, ['100-0', '100-1'], { timeoutMs: 20, intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(20)
    expect(await result).toEqual(['100-1'])
    expect(pveFetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not falsely report success when every polling read throws', async () => {
    vi.useFakeTimers()
    pveFetchMock.mockRejectedValue(new Error('temporary outage'))
    const result = waitForReplicationJobsGone(CONN, ['100-0'], { timeoutMs: 20, intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(20)
    expect(await result).toEqual(['100-0'])
    expect(pveFetchMock).toHaveBeenCalledTimes(3)
  })

  it('recovers from a transient read error once a later read confirms removal', async () => {
    vi.useFakeTimers()
    pveFetchMock.mockRejectedValueOnce(new Error('temporary outage')).mockResolvedValueOnce([])
    const result = waitForReplicationJobsGone(CONN, ['100-0'], { timeoutMs: 20, intervalMs: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect(await result).toEqual([])
    expect(pveFetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('deleteGuestSnapshots', () => {
  it('awaits each task before issuing the next snapshot delete', async () => {
    const events: string[] = []
    let finishFirst!: () => void
    const firstTask = new Promise<void>(resolve => { finishFirst = resolve })
    pveFetchMock.mockImplementation(async (_conn, path) => {
      const name = path.split('/').pop()
      events.push(`delete:${name}`)
      return `UPID:${name}`
    })
    waitForTaskMock.mockImplementation(async (_conn, _node, upid) => {
      events.push(`wait:${upid}`)
      if (upid === 'UPID:first') await firstTask
      events.push(`done:${upid}`)
    })
    const result = deleteGuestSnapshots(CONN, 'pve1', 'qemu', 100, ['first', 'second'])
    await Promise.resolve()
    expect(events).toEqual(['delete:first', 'wait:UPID:first'])
    expect(pveFetchMock).toHaveBeenCalledOnce()
    finishFirst()
    expect(await result).toEqual({ deleted: ['first', 'second'] })
    expect(events).toEqual([
      'delete:first', 'wait:UPID:first', 'done:UPID:first',
      'delete:second', 'wait:UPID:second', 'done:UPID:second',
    ])
    expect(waitForTaskMock.mock.calls).toEqual([[CONN, 'pve1', 'UPID:first'], [CONN, 'pve1', 'UPID:second']])
  })

  it('stops at the first DELETE failure and retains preceding deleted names', async () => {
    pveFetchMock.mockResolvedValueOnce('UPID:first').mockRejectedValueOnce(new Error('locked'))
    expect(await deleteGuestSnapshots(CONN, 'pve1', 'qemu', 100, ['first', 'second', 'third'])).toEqual({
      deleted: ['first'], failed: { name: 'second', error: 'locked' },
    })
    expect(pveFetchMock).toHaveBeenCalledTimes(2)
    expect(waitForTaskMock).toHaveBeenCalledOnce()
  })

  it('stops and reports a failed asynchronous deletion task', async () => {
    pveFetchMock.mockResolvedValue('UPID:first')
    waitForTaskMock.mockRejectedValue(new Error('task failed'))
    expect(await deleteGuestSnapshots(CONN, 'pve1', 'qemu', 100, ['first', 'second'])).toEqual({
      deleted: [], failed: { name: 'first', error: 'task failed' },
    })
    expect(pveFetchMock).toHaveBeenCalledOnce()
  })

  it('encodes snapshot names and accepts synchronous deletions', async () => {
    pveFetchMock.mockResolvedValue(null)
    expect(await deleteGuestSnapshots(CONN, 'pve1', 'qemu', '100', ['name/with space'])).toEqual({ deleted: ['name/with space'] })
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes/pve1/qemu/100/snapshot/name%2Fwith%20space', { method: 'DELETE' })
    expect(waitForTaskMock).not.toHaveBeenCalled()
  })
})

describe('haGroupExists', () => {
  it('returns false after PVE 9 migrates HA groups to rules', async () => {
    pveFetchMock.mockRejectedValue(new Error('ha groups have been migrated to rules'))
    expect(await haGroupExists(CONN, 'source-group')).toBe(false)
  })

  it('returns false for an unknown group', async () => {
    pveFetchMock.mockResolvedValue([{ group: 'other' }])
    expect(await haGroupExists(CONN, 'source-group')).toBe(false)
  })

  it('returns true for a known group', async () => {
    pveFetchMock.mockResolvedValue([{ group: 'source-group' }])
    expect(await haGroupExists(CONN, 'source-group')).toBe(true)
  })

  it('does not query without a group', async () => {
    expect(await haGroupExists(CONN)).toBe(false)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns false for a non-array response', async () => {
    pveFetchMock.mockResolvedValue({})
    expect(await haGroupExists(CONN, 'source-group')).toBe(false)
  })
})

describe('restoreHaResource', () => {
  it('posts captured fields with the destination sid and an existing group', async () => {
    pveFetchMock.mockResolvedValueOnce([{ group: 'source-group' }]).mockResolvedValueOnce(undefined)
    await restoreHaResource(CONN, HA, 'vm:200')
    expect(formBody(1)).toEqual({
      sid: 'vm:200', state: 'started', group: 'source-group', comment: 'keep this config',
      max_restart: '3', max_relocate: '2', failback: '0', 'auto-rebalance': '1',
    })
    expect(pveFetchMock).toHaveBeenNthCalledWith(2, CONN, '/cluster/ha/resources', {
      method: 'POST', body: expect.any(String), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  })

  it('omits an unavailable group and lets the requested state override the capture', async () => {
    pveFetchMock.mockResolvedValueOnce([]).mockResolvedValueOnce(undefined)
    await restoreHaResource(CONN, HA, 'vm:200', { state: 'stopped' })
    expect(formBody(1)).not.toHaveProperty('group')
    expect(formBody(1)).toMatchObject({ sid: 'vm:200', state: 'stopped' })
  })

  it('omits the group when the groups endpoint throws on PVE 9', async () => {
    pveFetchMock.mockRejectedValueOnce(new Error('ha groups have been migrated to rules')).mockResolvedValueOnce(undefined)
    await restoreHaResource(CONN, HA, 'vm:200')
    expect(formBody(1)).not.toHaveProperty('group')
    expect(formBody(1).sid).toBe('vm:200')
  })

  it('omits uncaptured optional fields', async () => {
    await restoreHaResource(CONN, { sid: 'vm:100' }, 'vm:200')
    expect(formBody(0)).toEqual({ sid: 'vm:200' })
    expect(pveFetchMock).toHaveBeenCalledOnce()
  })
})

describe('nextReplicationJobId', () => {
  it('starts at 100-0 for an empty configuration', async () => {
    expect(await nextReplicationJobId(CONN, 100)).toBe('100-0')
  })

  it('uses 100-2 when slots zero and one exist', async () => {
    pveFetchMock.mockResolvedValue([{ id: '100-0', guest: 100 }, { id: '100-1', guest: '100' }])
    expect(await nextReplicationJobId(CONN, '100')).toBe('100-2')
  })

  it('ignores other guests and uses the lowest gap', async () => {
    pveFetchMock.mockResolvedValue([{ id: '100-0', guest: 100 }, { id: '100-2', guest: 100 }, { id: '101-1', guest: 101 }])
    expect(await nextReplicationJobId(CONN, 100)).toBe('100-1')
  })

  it('falls back to slot zero when the read throws', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE unavailable'))
    expect(await nextReplicationJobId(CONN, 100)).toBe('100-0')
  })
})

describe('restoreReplicationJob', () => {
  it('creates the next local job with all supported fields, preserving a zero rate', async () => {
    pveFetchMock.mockResolvedValueOnce([{ id: '200-0', guest: 200 }]).mockResolvedValueOnce(undefined)
    expect(await restoreReplicationJob(CONN, {
      vmid: 200, target: 'target-peer', schedule: 'hourly', rate: 0, comment: 'job', disable: 1,
    })).toBe('200-1')
    expect(formBody(1)).toEqual({ id: '200-1', target: 'target-peer', type: 'local', schedule: 'hourly', rate: '0', comment: 'job', disable: '1' })
  })

  it('omits unset optional fields and an enabled job flag', async () => {
    await restoreReplicationJob(CONN, { vmid: 200, target: 'target-peer', disable: 0 })
    expect(formBody(1)).toEqual({ id: '200-0', target: 'target-peer', type: 'local' })
  })
})

describe('applyRestorePlan', () => {
  it('collects an HA POST failure and still attempts replication with the target VMID', async () => {
    pveFetchMock.mockImplementation(async (_conn, path, init) => {
      if (path === '/cluster/ha/resources' && init?.method === 'POST') throw new Error('HA denied')
      return []
    })
    expect(await applyRestorePlan(CONN, plan(), { vmid: '200', type: 'qemu', node: 'target' })).toEqual({
      restored: ['replication:200-0'], errors: ['HA resource vm:200: HA denied'],
    })
    const postCalls = pveFetchMock.mock.calls.filter(([, , init]) => init?.method === 'POST')
    expect(postCalls.map(([, path]) => path)).toEqual(['/cluster/ha/resources', '/cluster/replication'])
    expect(Object.fromEntries(new URLSearchParams(postCalls[1][2].body))).toEqual({
      id: '200-0', target: 'target-peer', type: 'local', schedule: '*/15', rate: '10', comment: 'source job',
    })
  })

  it('uses ct: for an LXC target and applies the requested HA state', async () => {
    const result = await applyRestorePlan(CONN, plan({ restoreReplication: false, haState: 'stopped' }), { vmid: 200, type: 'lxc' })
    expect(result).toEqual({ restored: ['ha:ct:200'], errors: [] })
    expect(formBody(1)).toMatchObject({ sid: 'ct:200', state: 'stopped' })
  })

  it('collects replication errors after a successful HA restore', async () => {
    pveFetchMock.mockImplementation(async (_conn, path, init) => {
      if (path === '/cluster/replication' && init?.method === 'POST') throw new Error('replication denied')
      return []
    })
    expect(await applyRestorePlan(CONN, plan(), { vmid: 200, type: 'qemu' })).toEqual({
      restored: ['ha:vm:200'], errors: ['Replication job for guest 200: replication denied'],
    })
  })

  it('applies explicit target replication schedule and rate instead of captured values', async () => {
    const result = await applyRestorePlan(CONN, plan({ restoreHa: false, replicationSchedule: 'daily', replicationRate: 0 }), { vmid: 200, type: 'qemu' })
    expect(result).toEqual({ restored: ['replication:200-0'], errors: [] })
    expect(formBody(1)).toMatchObject({ schedule: 'daily', rate: '0', target: 'target-peer' })
  })

  it('does nothing when both restore actions are disabled', async () => {
    expect(await applyRestorePlan(CONN, plan({ restoreHa: false, restoreReplication: false }), { vmid: 200, type: 'qemu' })).toEqual({ restored: [], errors: [] })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('skips absent HA and a missing replication destination', async () => {
    expect(await applyRestorePlan(CONN, plan({
      capture: { ha: null, replication: [], snapshotsDeleted: [] }, replicationTarget: undefined,
    }), { vmid: 200, type: 'qemu' })).toEqual({ restored: [], errors: [] })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('can create replication without a captured source job', async () => {
    const result = await applyRestorePlan(CONN, plan({ capture: { ha: null, replication: [], snapshotsDeleted: [] } }), { vmid: 200, type: 'qemu' })
    expect(result).toEqual({ restored: ['replication:200-0'], errors: [] })
    expect(formBody(1)).toEqual({ id: '200-0', target: 'target-peer', type: 'local' })
  })
})

describe('rollbackPrereqsOnSource', () => {
  it('replays captured HA sid and replication job ids verbatim without allocating new ids', async () => {
    const result = await rollbackPrereqsOnSource(CONN, CAPTURE)
    expect(result).toEqual({ restored: ['ha:vm:100', 'replication:100-7'], errors: [] })
    expect(formBody(1)).toMatchObject({ sid: 'vm:100' })
    expect(formBody(2)).toEqual({
      id: '100-7', target: 'source-peer', type: 'local', schedule: '*/15', rate: '10', comment: 'source job', disable: '1',
    })
    expect(pveFetchMock.mock.calls.some(([, path, init]) => path === '/cluster/replication' && init?.method !== 'POST')).toBe(false)
    expect(pveFetchMock.mock.calls.some(([, path]) => path.includes('/snapshot'))).toBe(false)
  })

  it('keeps restoring subsequent jobs after an HA failure and one replication failure', async () => {
    pveFetchMock.mockImplementation(async (_conn, path, init) => {
      if (path === '/cluster/ha/resources') throw new Error('HA unavailable')
      if (path === '/cluster/replication' && new URLSearchParams(init.body).get('id') === '100-7') throw new Error('job conflict')
      return []
    })
    const result = await rollbackPrereqsOnSource(CONN, {
      ...CAPTURE, replication: [...CAPTURE.replication, { id: '100-9', guest: 100, target: 'another-peer' }],
    })
    expect(result).toEqual({
      restored: ['replication:100-9'], errors: ['HA resource vm:100: HA unavailable', 'Replication job 100-7: job conflict'],
    })
    expect(formBody(3)).toEqual({ id: '100-9', target: 'another-peer', type: 'local' })
  })

  it('does nothing for an empty reversible capture', async () => {
    expect(await rollbackPrereqsOnSource(CONN, { ha: null, replication: [], snapshotsDeleted: ['gone'] })).toEqual({ restored: [], errors: [] })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

describe('findSiteRecoveryJobsForGuest', () => {
  const jobs = (data: any[]) => getReplicationJobsMock.mockResolvedValue({ data })

  it('reports the other guests a job covers, which forbid clearing it', async () => {
    jobs([{ id: 'j1', name: 'DR nightly', source_cluster: 'conn-1', vm_ids: [100, 101, 102], tags: [] }])
    expect(await findSiteRecoveryJobsForGuest('conn-1', 100)).toEqual([
      { id: 'j1', name: 'DR nightly', otherVmids: [101, 102], byTag: false },
    ])
  })

  it('flags a tag-driven job, where the guest silently stops matching', async () => {
    jobs([{ id: 'j2', name: 'by tag', source_cluster: 'conn-1', vm_ids: [100], tags: ['prod'] }])
    const [found] = await findSiteRecoveryJobsForGuest('conn-1', '100')
    expect(found).toMatchObject({ otherVmids: [], byTag: true })
  })

  it('ignores jobs of another source cluster and jobs without this guest', async () => {
    jobs([
      { id: 'other-cluster', source_cluster: 'conn-2', vm_ids: [100] },
      { id: 'other-guest', source_cluster: 'conn-1', vm_ids: [200, 300] },
    ])
    expect(await findSiteRecoveryJobsForGuest('conn-1', 100)).toEqual([])
  })

  it('falls back to the id when the job has no name', async () => {
    jobs([{ id: 'j3', source_cluster: 'conn-1', vm_ids: [100] }])
    expect((await findSiteRecoveryJobsForGuest('conn-1', 100))[0].name).toBe('j3')
  })

  it('stays advisory: an unreachable orchestrator yields no rows, never a throw', async () => {
    getReplicationJobsMock.mockRejectedValue(new Error('orchestrator down'))
    await expect(findSiteRecoveryJobsForGuest('conn-1', 100)).resolves.toEqual([])
  })

  it('tolerates a response without a jobs array', async () => {
    getReplicationJobsMock.mockResolvedValue({})
    await expect(findSiteRecoveryJobsForGuest('conn-1', 100)).resolves.toEqual([])
  })
})
