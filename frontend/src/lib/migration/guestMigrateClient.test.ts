import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  guestDiskMoveUrl,
  guestMigrateUrl,
  moveDisksThenMigrate,
  startDiskMove,
  startPlannedMigration,
  migrateGuestAndWait,
  migrationFailureText,
  runInBatches,
  startGuestMigration,
} from './guestMigrateClient'

const UPID = 'UPID:pve1:0000ABCD:00001234:6A000000:qmigrate:100:root@pam:'
const GUEST = { connId: 'conn 1', node: 'pve1', type: 'qemu', vmid: 100 }
const FAST = { intervalMs: 1, timeoutMs: 2_000 }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

/** fetch answering the POST with `post`, then each task poll from `polls` in turn (the last one repeats). */
function stubFetch(post: Response, polls: unknown[] = []) {
  let poll = 0
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return post
    const body = polls[Math.min(poll++, polls.length - 1)]
    return json(body)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startGuestMigration', () => {
  it('posts the body and returns the UPID of the task', async () => {
    const fetchMock = stubFetch(json({ success: true, data: UPID }))

    await expect(startGuestMigration(GUEST, { target: 'pve2', online: true })).resolves.toBe(UPID)
    expect(fetchMock).toHaveBeenCalledWith(guestMigrateUrl(GUEST), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ target: 'pve2', online: true }),
    }))
    expect(guestMigrateUrl(GUEST)).toBe('/api/v1/connections/conn%201/guests/qemu/pve1/100/migrate')
  })

  it('rejects with the route error', async () => {
    stubFetch(json({ error: 'Snapshots block the migration' }, 409))

    await expect(startGuestMigration(GUEST, {})).rejects.toThrow('Snapshots block the migration')
  })
})

describe('migrateGuestAndWait (#926)', () => {
  it('is not a success on HTTP 200: it waits for the task to end OK', async () => {
    const fetchMock = stubFetch(json({ data: UPID }), [
      { status: 'running' },
      { status: 'running' },
      { status: 'stopped', exitstatus: 'OK' },
    ])

    const outcome = await migrateGuestAndWait(GUEST, { target: 'pve2' }, FAST)

    expect(outcome).toEqual({ ok: true, upid: UPID, node: 'pve1' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/api/v1/tasks/conn%201/pve1/${encodeURIComponent(UPID)}`)
  })

  it('reports the failure reason of a task that PVE accepted then aborted', async () => {
    stubFetch(json({ data: UPID }), [
      { status: 'stopped', exitstatus: 'migration aborted', failureReason: "can't migrate VM which uses local devices: hostpci0" },
    ])

    const outcome = await migrateGuestAndWait(GUEST, {}, FAST)

    expect(outcome).toEqual({ ok: false, upid: UPID, node: 'pve1', reason: "can't migrate VM which uses local devices: hostpci0" })
  })

  it('reports a refused request without a task', async () => {
    stubFetch(json({ error: 'Invalid input' }, 400))

    expect(await migrateGuestAndWait(GUEST, {}, FAST)).toEqual({ ok: false, upid: null, node: 'pve1', reason: 'Invalid input' })
  })

  it('does not claim success for a task still running at the deadline', async () => {
    stubFetch(json({ data: UPID }), [{ status: 'running' }])

    const outcome = await migrateGuestAndWait(GUEST, {}, { intervalMs: 1, timeoutMs: 20 })

    expect(outcome).toEqual({ ok: false, upid: UPID, node: 'pve1', stillRunning: true })
  })

  it('counts an accepted request without a UPID as done, having nothing to follow', async () => {
    stubFetch(json({ success: true, data: null }))

    expect(await migrateGuestAndWait(GUEST, {}, FAST)).toEqual({ ok: true, upid: null, node: 'pve1' })
  })
})

describe('runInBatches', () => {
  it('runs each batch in parallel and the next one only after it', async () => {
    const log: string[] = []
    const settled: number[] = []

    const results = await runInBatches([1, 2, 3, 4, 5], 2, async n => {
      log.push(`start ${n}`)
      await new Promise(r => setTimeout(r, n === 1 ? 5 : 1))
      log.push(`end ${n}`)
      return n * 10
    }, (_item, _result, done) => settled.push(done))

    expect(results).toEqual([10, 20, 30, 40, 50])
    expect(log.indexOf('start 3')).toBeGreaterThan(log.indexOf('end 1'))
    expect(log.indexOf('start 3')).toBeGreaterThan(log.indexOf('end 2'))
    expect(settled).toEqual([1, 2, 3, 4, 5])
  })
})

describe('migrationFailureText', () => {
  const t = (key: string) => `t:${key}`

  it('gives the reason, the still-running notice or the generic label', () => {
    expect(migrationFailureText({ ok: false, upid: null, node: 'pve1', reason: 'CT is locked' }, t)).toBe('CT is locked')
    expect(migrationFailureText({ ok: false, upid: UPID, node: 'pve1', stillRunning: true }, t)).toBe('t:vmActions.migrateStillRunning')
    expect(migrationFailureText({ ok: false, upid: UPID, node: 'pve1', reason: '' }, t)).toBe('t:updates.vmMigrateFailed')
  })
})

describe('moveDisksThenMigrate (#1402)', () => {
  const MOVE0 = 'UPID:pve1:0000ABCD:00001234:6A000001:qmmove:100:root@pam:'
  const MOVE1 = 'UPID:pve1:0000ABCD:00001234:6A000002:qmmove:100:root@pam:'

  /** fetch answering each POST in turn; records what was posted where. */
  function stubPosts(answers: Response[]) {
    const posts: Array<{ url: string; body: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body)) })
      return answers[posts.length - 1]
    }))
    return posts
  }

  /** A task tracker that keeps the tasks, to end them by hand. */
  function tracker() {
    const tasks: Array<Parameters<Parameters<typeof moveDisksThenMigrate>[0]>[0]> = []
    return { tasks, trackTask: (task: (typeof tasks)[number]) => { tasks.push(task) } }
  }

  const flush = () => new Promise(resolve => setTimeout(resolve, 0))

  const opts = (over: Partial<Parameters<typeof moveDisksThenMigrate>[3]> = {}) => ({
    disks: ['scsi0', 'scsi1'],
    storage: 'ceph',
    moveDescription: (disk: string) => `move ${disk}`,
    migrateDescription: 'migrate',
    ...over,
  })

  it('moves each disk in turn, deleting the source, then migrates without a target storage', async () => {
    const posts = stubPosts([json({ data: MOVE0 }), json({ data: MOVE1 }), json({ data: UPID })])
    const { tasks, trackTask } = tracker()

    await expect(moveDisksThenMigrate(trackTask, GUEST, { target: 'pve2', online: true }, opts()))
      .resolves.toBe(MOVE0)

    // Only the first move is requested until its task ends OK.
    expect(posts).toEqual([{ url: guestDiskMoveUrl(GUEST), body: { disk: 'scsi0', storage: 'ceph', deleteSource: true } }])
    expect(tasks[0]).toMatchObject({ upid: MOVE0, node: 'pve1', description: 'move scsi0' })

    tasks[0].onSuccess?.()
    await flush()
    expect(posts[1].body).toEqual({ disk: 'scsi1', storage: 'ceph', deleteSource: true })
    expect(posts).toHaveLength(2)

    tasks[1].onSuccess?.()
    await flush()
    expect(posts[2]).toEqual({ url: guestMigrateUrl(GUEST), body: { target: 'pve2', online: true } })
    expect(tasks[2]).toMatchObject({ upid: UPID, description: 'migrate' })
  })

  it('does not migrate when a disk move fails', async () => {
    const posts = stubPosts([json({ data: MOVE0 })])
    const { tasks, trackTask } = tracker()
    const onDone = vi.fn()

    await moveDisksThenMigrate(trackTask, GUEST, { target: 'pve2' }, opts({ onDone }))
    tasks[0].onError?.()
    await flush()

    expect(posts).toHaveLength(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('rejects when the first move is refused, so the dialog shows why', async () => {
    stubPosts([json({ error: 'Quota exceeded' }, 409)])

    await expect(moveDisksThenMigrate(tracker().trackTask, GUEST, {}, opts())).rejects.toThrow('Quota exceeded')
  })

  it('reports a refusal that comes after the first move', async () => {
    stubPosts([json({ data: MOVE0 }), json({ data: MOVE1 }), json({ error: 'node offline' }, 500)])
    const { tasks, trackTask } = tracker()
    const onRequestError = vi.fn()
    const onDone = vi.fn()

    await moveDisksThenMigrate(trackTask, GUEST, {}, opts({ onRequestError, onDone }))
    tasks[0].onSuccess?.()
    await flush()
    tasks[1].onSuccess?.()
    await flush()

    expect(onRequestError).toHaveBeenCalledWith('node offline')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('goes on to the next step when a move gives no task to follow', async () => {
    const posts = stubPosts([json({ data: null }), json({ data: UPID })])

    await expect(moveDisksThenMigrate(tracker().trackTask, GUEST, { target: 'pve2' }, opts({ disks: ['scsi0'] })))
      .resolves.toBe(UPID)
    expect(posts).toHaveLength(2)
  })
})

describe('startDiskMove', () => {
  it('falls back on the HTTP status when the route gives no error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 502 })))

    await expect(startDiskMove(GUEST, 'scsi0', 'ceph')).rejects.toThrow('HTTP 502')
  })
})

describe('startPlannedMigration (#1402)', () => {
  const MOVE = 'UPID:pve1:0000ABCD:00001234:6A000001:qmmove:100:root@pam:'
  const descriptions = { moveDescription: (disk: string) => `move ${disk}`, migrateDescription: 'migrate' }

  function stubPost(answer: Response) {
    const posts: Array<{ url: string; body: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body)) })
      return answer
    }))
    return posts
  }

  it('migrates straight away with the target storage when nothing is to be moved first', async () => {
    const posts = stubPost(json({ data: UPID }))

    await expect(startPlannedMigration(vi.fn(), GUEST, { target: 'pve2', online: true, targetStorage: 'ceph', withLocalDisks: true }, descriptions))
      .resolves.toEqual({ upid: UPID, first: 'migrate' })
    expect(posts).toEqual([{ url: guestMigrateUrl(GUEST), body: { target: 'pve2', online: true, withLocalDisks: true, targetstorage: 'ceph' } }])
  })

  it('starts with the disk move when the plan asks for one', async () => {
    const posts = stubPost(json({ data: MOVE }))

    await expect(startPlannedMigration(vi.fn(), GUEST, { target: 'pve2', online: false, targetStorage: 'ceph', moveFirst: ['scsi0'] }, descriptions))
      .resolves.toEqual({ upid: MOVE, first: 'move' })
    expect(posts).toEqual([{ url: guestDiskMoveUrl(GUEST), body: { disk: 'scsi0', storage: 'ceph', deleteSource: true } }])
  })

  it('sends no storage when the disks keep theirs', async () => {
    const posts = stubPost(json({ data: UPID }))

    await startPlannedMigration(vi.fn(), GUEST, { target: 'pve2', online: true, moveFirst: [] }, descriptions)
    expect(posts[0].body).toEqual({ target: 'pve2', online: true })
  })
})
