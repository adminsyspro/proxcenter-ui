import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BULK_POWER_PER_NODE_DEFAULT,
  bulkPowerMessage,
  bulkPowerSeverity,
  clampPerNode,
  guestPowerUrl,
  powerActionApplies,
  readPerNodePreference,
  runBulkGuestPower,
  writePerNodePreference,
  type BulkPowerGuest,
} from './bulkGuestPower'

const guest = (vmid: number, type = 'qemu', node = 'pve/1', connId = 'conn 1'): BulkPowerGuest => ({ connId, node, type, vmid })

function respond(byVmid: Record<number, number | 'network' | 'no-upid'>) {
  return vi.fn(async (url: string) => {
    const vmid = Number(url.split('/').at(-2))
    const status = byVmid[vmid] ?? 200
    if (status === 'network') throw new TypeError('Failed to fetch')
    if (status === 'no-upid') return new Response(JSON.stringify({ data: null }), { status: 200 })

    return new Response(JSON.stringify(status < 400 ? { data: `UPID:n:${vmid}` } : { error: `refused ${vmid}` }), { status })
  })
}

const asFetch = (f: unknown) => f as typeof fetch
const okTask = vi.fn(async () => ({ outcome: 'ok' as const }))

describe('guestPowerUrl', () => {
  it('escapes the connection, the node and the vmid', () => {
    expect(guestPowerUrl(guest(101, 'lxc'), 'start')).toBe('/api/v1/connections/conn%201/guests/lxc/pve%2F1/101/start')
  })
})

describe('powerActionApplies', () => {
  it('starts stopped guests and acts on running ones otherwise', () => {
    expect(powerActionApplies('start', 'stopped')).toBe(true)
    expect(powerActionApplies('start', 'running')).toBe(false)
    expect(powerActionApplies('shutdown', 'running')).toBe(true)
    expect(powerActionApplies('reboot', 'stopped')).toBe(false)
    expect(powerActionApplies('stop', undefined)).toBe(false)
  })
})

describe('clampPerNode and the stored preference', () => {
  const store = new Map<string, string>()
  const storage = {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { store.set(k, v) }),
  }

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', storage)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the value within 1-8 and falls back on the default', () => {
    expect(clampPerNode(0)).toBe(1)
    expect(clampPerNode(12)).toBe(8)
    expect(clampPerNode('3')).toBe(3)
    expect(clampPerNode('x')).toBe(BULK_POWER_PER_NODE_DEFAULT)
  })

  it('remembers the last choice of this browser', () => {
    expect(readPerNodePreference()).toBe(BULK_POWER_PER_NODE_DEFAULT)
    writePerNodePreference(2)
    expect(readPerNodePreference()).toBe(2)
  })

  it('survives a storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    expect(() => writePerNodePreference(3)).not.toThrow()
    expect(readPerNodePreference()).toBe(BULK_POWER_PER_NODE_DEFAULT)
  })
})

describe('runBulkGuestPower', () => {
  it('sends each guest to its own route and follows its task', async () => {
    const fetchImpl = respond({})
    const waitTask = vi.fn(async () => ({ outcome: 'ok' as const }))

    const outcome = await runBulkGuestPower([guest(1), guest(2)], 'start', { fetchImpl: asFetch(fetchImpl), waitTask })

    expect(outcome).toMatchObject({ success: 2, errors: 0 })
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/connections/conn%201/guests/qemu/pve%2F1/1/start', { method: 'POST' })
    expect(waitTask).toHaveBeenCalledWith('conn 1', 'pve/1', 'UPID:n:1')
  })

  it('reports refusals, network failures and failed tasks per guest, keeping the first reason', async () => {
    const fetchImpl = respond({ 2: 403, 3: 'network' })
    const waitTask = vi.fn(async (_c: string, _n: string, upid: string) => (upid.endsWith(':4')
      ? { outcome: 'failed' as const, error: 'exit 1', reason: 'cannot start 4' }
      : { outcome: 'ok' as const }))

    const outcome = await runBulkGuestPower([guest(1), guest(2), guest(3), guest(4)], 'shutdown', { fetchImpl: asFetch(fetchImpl), waitTask })

    expect(outcome).toMatchObject({ success: 1, errors: 3, firstError: 'refused 2' })
    expect(outcome.results?.map(r => r.status)).toEqual(['completed', 'failed', 'failed', 'failed'])
    expect(outcome.results?.[2].error).toBe('Failed to fetch')
    expect(outcome.results?.[3].error).toBe('cannot start 4')
  })

  it('falls back on the exit status, and on a generic text, when a failed task gives no reason', async () => {
    const waitTask = vi.fn()
      .mockResolvedValueOnce({ outcome: 'failed', error: 'exit 2' })
      .mockResolvedValueOnce({ outcome: 'failed' })

    const outcome = await runBulkGuestPower([guest(1), guest(2)], 'stop', { fetchImpl: asFetch(respond({})), waitTask, perNode: 1 })

    expect(outcome.results?.map(r => r.error)).toEqual(['exit 2', 'task failed'])
  })

  it('counts a task done with warnings as done, keeping the warning', async () => {
    const waitTask = vi.fn(async () => ({ outcome: 'ok' as const, warning: 'WARNINGS: 1' }))
    const outcome = await runBulkGuestPower([guest(201, 'lxc')], 'start', { fetchImpl: asFetch(respond({})), waitTask })

    expect(outcome).toMatchObject({ success: 1, errors: 0 })
    expect(outcome.results?.[0]).toEqual({ status: 'completed', warning: 'WARNINGS: 1' })
  })

  it('follows the task through the task route by default, warnings accepted', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes('/tasks/')
      ? new Response(JSON.stringify({ status: 'stopped', exitstatus: 'WARNINGS: 1' }), { status: 200 })
      : new Response(JSON.stringify({ data: 'UPID:n:7' }), { status: 200 })))
    vi.stubGlobal('fetch', fetchImpl)
    try {
      const outcome = await runBulkGuestPower([guest(7)], 'start', { fetchImpl: asFetch(fetchImpl) })
      expect(outcome.results?.[0]).toEqual({ status: 'completed', warning: 'WARNINGS: 1' })
      expect(fetchImpl.mock.calls.some(([u]) => String(u).startsWith('/api/v1/tasks/conn%201/pve%2F1/UPID%3An%3A7'))).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('counts an order without UPID as taken, and a task still running after the budget apart', async () => {
    const waitTask = vi.fn(async () => ({ outcome: 'timeout' as const }))
    const outcome = await runBulkGuestPower([guest(1), guest(2)], 'reboot', { fetchImpl: asFetch(respond({ 1: 'no-upid' })), waitTask })

    expect(outcome).toMatchObject({ success: 1, errors: 0, stillRunning: 1 })
    expect(waitTask).toHaveBeenCalledTimes(1)
    expect(bulkPowerSeverity(outcome)).toBe('warning')
  })

  it('holds a slot until the task ends: never more than perNode tasks on one host', async () => {
    let inFlight = 0
    let peak = 0
    const waitTask = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 2))
      inFlight--

      return { outcome: 'ok' as const }
    })

    const outcome = await runBulkGuestPower(Array.from({ length: 12 }, (_, i) => guest(i)), 'start', { fetchImpl: asFetch(respond({})), waitTask, perNode: 3 })

    expect(outcome.success).toBe(12)
    expect(peak).toBe(3)
  })

  it('runs the hosts side by side, under the total cap', async () => {
    const perHost = new Map<string, number>()
    let inFlight = 0
    let peak = 0
    const peakPerHost = new Map<string, number>()
    const waitTask = vi.fn(async (connId: string, node: string) => {
      const key = `${connId}/${node}`
      perHost.set(key, (perHost.get(key) ?? 0) + 1)
      peakPerHost.set(key, Math.max(peakPerHost.get(key) ?? 0, perHost.get(key)!))
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 2))
      inFlight--
      perHost.set(key, perHost.get(key)! - 1)

      return { outcome: 'ok' as const }
    })
    // Six hosts over two clusters, the same node name in both.
    const guests = Array.from({ length: 36 }, (_, i) => guest(i, 'qemu', `pve${i % 3}`, i % 2 ? 'a' : 'b'))

    await runBulkGuestPower(guests, 'start', { fetchImpl: asFetch(respond({})), waitTask, perNode: 2, total: 10 })

    expect(peak).toBe(10)
    expect(Math.max(...peakPerHost.values())).toBe(2)
    expect(peakPerHost.size).toBe(6)
  })

  it('reports every change of status by index', async () => {
    const updates: string[] = []
    await runBulkGuestPower([guest(1)], 'start', { fetchImpl: asFetch(respond({})), waitTask: okTask, onUpdate: (i, r) => updates.push(`${i}:${r.status}`) })

    expect(updates).toEqual(['0:running', '0:completed'])
  })

  it('stops sending once told to: the guests not sent yet are cancelled, the sent ones finish', async () => {
    let stop = false
    const waitTask = vi.fn(async () => {
      stop = true
      await new Promise(r => setTimeout(r, 1))

      return { outcome: 'ok' as const }
    })

    const outcome = await runBulkGuestPower([guest(1), guest(2), guest(3)], 'start', {
      fetchImpl: asFetch(respond({})), waitTask, perNode: 1, shouldContinue: () => !stop,
    })

    expect(outcome).toMatchObject({ success: 1, errors: 0, cancelled: 2 })
    expect(outcome.results?.map(r => r.status)).toEqual(['completed', 'cancelled', 'cancelled'])
    expect(bulkPowerSeverity(outcome)).toBe('warning')
  })

  it('cancels everything when stopped before the first send', async () => {
    const fetchImpl = respond({})
    const outcome = await runBulkGuestPower([guest(1), guest(2)], 'start', { fetchImpl: asFetch(fetchImpl), shouldContinue: () => false })

    expect(outcome).toMatchObject({ success: 0, cancelled: 2 })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(bulkPowerSeverity(outcome)).toBe('error')
  })

  it('settles at once on an empty batch', async () => {
    expect(await runBulkGuestPower([], 'start')).toEqual({ success: 0, errors: 0, results: [] })
  })
})

describe('bulkPowerMessage', () => {
  const t = (key: string, v?: Record<string, string | number>) => `${key}${v ? JSON.stringify(v) : ''}`

  it('says how many went through, with the first refusal and the tasks still running', () => {
    expect(bulkPowerMessage({ success: 2, errors: 0 }, 'Starting', t)).toBe('vmActions.bulkSuccess{"description":"Starting","count":2}')
    expect(bulkPowerMessage({ success: 1, errors: 1, firstError: 'locked', stillRunning: 1 }, 'Starting', t))
      .toBe('vmActions.bulkPartial{"description":"Starting","success":1,"errors":1} (locked) vmActions.bulkStillRunning{"count":1}')
    expect(bulkPowerMessage({ success: 0, errors: 2, firstError: 'no' }, 'Starting', t)).toBe('vmActions.bulkFailed{"description":"Starting","errors":2} (no)')
  })
})

describe('bulkPowerSeverity', () => {
  it('is success, warning or error after how many went through', () => {
    expect(bulkPowerSeverity({ success: 3, errors: 0 })).toBe('success')
    expect(bulkPowerSeverity({ success: 2, errors: 1 })).toBe('warning')
    expect(bulkPowerSeverity({ success: 0, errors: 3 })).toBe('error')
    expect(bulkPowerSeverity({ success: 0, errors: 1, stillRunning: 1 })).toBe('warning')
  })
})
