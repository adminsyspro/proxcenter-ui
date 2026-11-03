/**
 * The bounds of the guest firewall coverage (UA44) that the route test cannot reach easily: the time budget, the
 * request that stops waiting while the computation goes on, the sample and the node interleave.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COVERAGE_BUDGET_MS,
  COVERAGE_SLOW_CALL_MS,
  forceFloorMs,
  isTimeoutError,
  computeGuestCoverage,
  getGuestCoverage,
  guestListHash,
  interleaveByNode,
  evictGuestCoverage,
  resetGuestCoverage,
  sampleGuests,
  type CoverageGuest,
} from './guestCoverage'

const g = (vmid: number, node = 'pve1', type: 'qemu' | 'lxc' = 'qemu'): CoverageGuest => ({ vmid: String(vmid), node, type })

beforeEach(resetGuestCoverage)

describe('sampleGuests', () => {
  it('keeps every guest up to the cap, and a spread above it', () => {
    const many = Array.from({ length: 1000 }, (_, i) => g(1000 + i))

    expect(sampleGuests(many.slice(0, 200))).toHaveLength(200)
    const sample = sampleGuests(many)
    expect(sample).toHaveLength(200)
    expect(new Set(sample.map(s => s.vmid)).size).toBe(200)
    // Spread over the whole vmid range, not the first 200.
    expect(sample.some(s => Number(s.vmid) < 1200)).toBe(true)
    expect(sample.some(s => Number(s.vmid) >= 1800)).toBe(true)
  })

  it('is stable: one guest added or removed changes the sample by at most that guest and one other', () => {
    const many = Array.from({ length: 230 }, (_, i) => g(1000 + i))
    const before = new Set(sampleGuests(many).map(s => s.vmid))

    for (const candidate of [g(5000), g(5001), g(5002)]) {
      const after = new Set(sampleGuests([...many, candidate]).map(s => s.vmid))
      const gone = [...before].filter(v => !after.has(v))
      const come = [...after].filter(v => !before.has(v))
      expect(gone.length).toBeLessThanOrEqual(1)
      expect(come.length).toBeLessThanOrEqual(1)
      if (come.length === 1) expect(come[0]).toBe(candidate.vmid)
    }
    const removed = new Set(sampleGuests(many.slice(1)).map(s => s.vmid))
    expect([...removed].filter(v => !before.has(v)).length).toBeLessThanOrEqual(1)
  })
})

describe('interleaveByNode', () => {
  it('takes the nodes in turn', () => {
    const order = interleaveByNode([g(1, 'a'), g(2, 'a'), g(3, 'a'), g(4, 'b'), g(5, 'c')]).map(x => x.vmid)

    expect(order).toEqual(['1', '4', '5', '2', '3'])
  })
})

describe('guestListHash', () => {
  it('ignores the order and sees a guest move to another node', () => {
    expect(guestListHash([g(1), g(2, 'pve2')])).toBe(guestListHash([g(2, 'pve2'), g(1)]))
    expect(guestListHash([g(1), g(2, 'pve2')])).not.toBe(guestListHash([g(1), g(2, 'pve3')]))
  })
})

describe('computeGuestCoverage', () => {
  it('starts no call past the time budget and counts what was left as unknown', async () => {
    let clock = 0
    const fetchOptions = vi.fn(async () => {
      clock += COVERAGE_BUDGET_MS / 2
      return { enable: 1 }
    })

    const result = await computeGuestCoverage([g(1), g(2), g(3), g(4), g(5), g(6)], {
      listGuests: async () => [],
      guestNet: () => ({ nicFirewall: true, vlans: [] }),
      fetchOptions,
      now: () => clock,
    })

    expect(fetchOptions.mock.calls.length).toBeLessThan(6)
    expect(result.enabled + result.unknown).toBe(6)
    expect(result.unknown).toBeGreaterThan(0)
    expect(result.partial).toBe(true)
  })

  it('counts an unreadable options answer as unknown, never as protected', async () => {
    const result = await computeGuestCoverage([g(1), g(2)], {
      listGuests: async () => [],
      guestNet: () => ({ nicFirewall: true, vlans: [] }),
      fetchOptions: async guest => {
        if (guest.vmid === '1') throw new Error('HTTP 500')
        return { enable: '1' }
      },
    })

    expect(result).toMatchObject({ enabled: 1, unknown: 1, disabled: 0, partial: true })
  })
})

describe('getGuestCoverage', () => {
  it('stops waiting and says it is computing, then serves the figures once done, from the same computation', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const fetchOptions = vi.fn(async () => {
      await gate
      return { enable: 1 }
    })
    const deps = { listGuests: async () => [g(1), g(2)], guestNet: () => ({ nicFirewall: true, vlans: [] }), fetchOptions }

    const first = await getGuestCoverage('c1', deps, { waitMs: 5 })
    expect(first).toEqual({ result: null, computing: true })

    const second = await getGuestCoverage('c1', deps, { waitMs: 5 })
    expect(second.computing).toBe(true)

    release()
    const third = await getGuestCoverage('c1', deps, { waitMs: 1000 })
    expect(third.computing).toBe(false)
    expect(third.result).toMatchObject({ total: 2, enabled: 2 })
    expect(fetchOptions).toHaveBeenCalledTimes(2)
  })
})

describe('slow Proxmox (the 1.4.12 trap)', () => {
  it('starts no call once one took longer than the slow threshold', async () => {
    let clock = 0
    const fetchOptions = vi.fn(async () => {
      clock += COVERAGE_SLOW_CALL_MS + 1
      return { enable: 1 }
    })

    const result = await computeGuestCoverage([g(1), g(2), g(3), g(4), g(5), g(6)], {
      listGuests: async () => [],
      guestNet: () => ({ nicFirewall: true, vlans: [] }),
      fetchOptions,
      now: () => clock,
    })

    // The two calls of the node's lanes were already started; nothing after.
    expect(fetchOptions.mock.calls.length).toBeLessThanOrEqual(2)
    expect(result.unknown).toBeGreaterThanOrEqual(4)
  })

  it('starts no call once one timed out', async () => {
    const fetchOptions = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) })

    await computeGuestCoverage(Array.from({ length: 20 }, (_, i) => g(i + 1, `pve${i % 3}`)), {
      listGuests: async () => [],
      guestNet: () => ({ nicFirewall: true, vlans: [] }),
      fetchOptions,
    })

    expect(fetchOptions.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('does not trip on a plain refusal', async () => {
    const fetchOptions = vi.fn(async () => { throw new Error('HTTP 403') })

    await computeGuestCoverage([g(1), g(2), g(3), g(4)], { listGuests: async () => [], guestNet: () => undefined, fetchOptions })

    expect(fetchOptions).toHaveBeenCalledTimes(4)
  })

  it('tells timeouts apart', () => {
    expect(isTimeoutError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true)
    expect(isTimeoutError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true)
    expect(isTimeoutError(new Error('Orchestrator request timed out'))).toBe(true)
    expect(isTimeoutError(new Error('HTTP 500'))).toBe(false)
  })
})

describe('forceFloorMs', () => {
  it('is 30 s, or ten times the last full read when that was longer', () => {
    expect(forceFloorMs(0)).toBe(30_000)
    expect(forceFloorMs(12_000)).toBe(120_000)
  })
})

describe('offline nodes', () => {
  it('asks no guest of an offline node', async () => {
    const fetchOptions = vi.fn(async () => ({ enable: 1 }))

    const result = await computeGuestCoverage([g(1), { ...g(2, 'pve2'), offline: true }], {
      listGuests: async () => [], guestNet: () => ({ nicFirewall: true, vlans: [] }), fetchOptions,
    })

    expect(fetchOptions).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ enabled: 1, unknown: 1 })
  })
})

describe('evictGuestCoverage (connection deleted)', () => {
  it('drops the answers, and a read still running stores nothing', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const fetchOptions = vi.fn(async () => { await gate; return { enable: 1 } })
    const deps = { listGuests: async () => [g(1)], guestNet: () => ({ nicFirewall: true, vlans: [] }), fetchOptions }

    const first = getGuestCoverage('gone', deps, { waitMs: 1000 })
    await new Promise(resolve => setTimeout(resolve, 0))
    evictGuestCoverage('gone')
    release()
    expect((await first).result).toMatchObject({ enabled: 1 })

    // Nothing was kept: the next answer reads again.
    await getGuestCoverage('gone', deps, { waitMs: 1000 })
    expect(fetchOptions).toHaveBeenCalledTimes(2)
  })
})
