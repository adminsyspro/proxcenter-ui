import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn() }))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/ssh/exec', () => ({ executeSSH: vi.fn() }))
vi.mock('@/lib/ssh/node-endpoint', () => ({ resolveNodeSshEndpoint: vi.fn() }))

import { collectHardeningData, runPool } from './collectHardeningData'

const tick = () => new Promise(r => setTimeout(r, 1))

describe('runPool', () => {
  it('never has more than `limit` calls in flight and runs every item once', async () => {
    let inFlight = 0
    let peak = 0
    const seen: number[] = []

    await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async n => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await tick()
      seen.push(n)
      inFlight--
    })

    expect(peak).toBe(3)
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('does not wait for the slowest of a batch before starting the next item', async () => {
    const started: string[] = []
    let releaseSlow: () => void = () => {}
    const slow = new Promise<void>(r => { releaseSlow = r })

    const run = runPool(['slow', 'a', 'b', 'c'], 2, async item => {
      started.push(item)
      if (item === 'slow') await slow
      else await tick()
    })

    await vi.waitFor(() => expect(started).toEqual(['slow', 'a', 'b', 'c']))
    releaseSlow()
    await run
  })

  it('copes with an empty list and a limit above the item count', async () => {
    const fn = vi.fn(async () => {})
    await runPool([], 4, fn)
    await runPool(['x'], 10, fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('collectHardeningData guest concurrency', () => {
  const guests = Array.from({ length: 12 }, (_, i) => ({ type: i % 2 ? 'lxc' : 'qemu', vmid: 100 + i, node: 'pve1' }))
  let inFlight = 0
  let peak = 0

  beforeEach(() => {
    inFlight = 0
    peak = 0
    pveFetchMock.mockReset()
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === '/nodes') return [{ node: 'pve1' }]
      if (path === '/cluster/resources') return guests
      if (!/\/(qemu|lxc)\/\d+\//.test(path)) return []
      inFlight++
      peak = Math.max(peak, inFlight)
      await tick()
      inFlight--
      return path.endsWith('/config') ? { name: 'g' } : []
    })
  })

  const collect = (guestConcurrency?: number) =>
    collectHardeningData({ connectionId: 'c1', conn: {}, sshEnabled: false, guestConcurrency })

  it('reads 3 calls per guest with at most 3 x guestConcurrency in flight', async () => {
    const data = await collect(2)

    expect(peak).toBe(6)
    expect(Object.keys(data.vmConfigs ?? {})).toHaveLength(12)
  })

  it('defaults to 4 guests at a time (12 requests)', async () => {
    await collect(undefined)
    expect(peak).toBe(12)
  })

  it('bounds an out-of-range value to 1..10 guests', async () => {
    await collect(50)
    expect(peak).toBe(30)

    peak = 0
    await collect(0)
    expect(peak).toBe(3)
  })
})
