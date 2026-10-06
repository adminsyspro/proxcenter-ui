import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  guestMigrateUrl,
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
