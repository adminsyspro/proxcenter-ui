/**
 * The bounds of the guest firewall coverage (UA44) that the route test cannot reach easily: the time budget, the
 * request that stops waiting while the computation goes on, the sample and the node interleave.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COVERAGE_BUDGET_MS,
  computeGuestCoverage,
  getGuestCoverage,
  guestListHash,
  interleaveByNode,
  resetGuestCoverage,
  sampleGuests,
  type CoverageGuest,
} from './guestCoverage'

const g = (vmid: number, node = 'pve1', type: 'qemu' | 'lxc' = 'qemu'): CoverageGuest => ({ vmid: String(vmid), node, type })

beforeEach(resetGuestCoverage)

describe('sampleGuests', () => {
  it('keeps every guest up to the cap, and an even spread above it', () => {
    const many = Array.from({ length: 1000 }, (_, i) => g(1000 + i))

    expect(sampleGuests(many.slice(0, 200))).toHaveLength(200)
    const sample = sampleGuests(many)
    expect(sample).toHaveLength(200)
    expect(new Set(sample.map(s => s.vmid)).size).toBe(200)
    expect(sample[0].vmid).toBe('1000')
    expect(Number(sample[199].vmid)).toBeGreaterThanOrEqual(1990)
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
      nicFirewall: () => true,
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
      nicFirewall: () => true,
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
    const deps = { listGuests: async () => [g(1), g(2)], nicFirewall: () => true, fetchOptions }

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
