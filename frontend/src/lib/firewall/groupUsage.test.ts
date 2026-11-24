/**
 * Which guests carry which security group: what is read from Proxmox, how often, and under which bounds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { POOL_SLOW_CALL_MS } from '@/lib/inventory/connectionPool'

import type { CoverageGuest } from './guestCoverage'
import {
  USAGE_BUDGET_MS, USAGE_FORCE_MIN_MS, USAGE_MAX_GUESTS, USAGE_TTL_MS,
  evictGroupUsage, forgetGroupUsage, getGroupUsage, groupsOf, resetGroupUsage, usageForceFloorMs,
  type UsageDeps, type UsageRule,
} from './groupUsage'

const g = (vmid: number, node = 'pve1', extra: Partial<CoverageGuest> = {}): CoverageGuest => ({ vmid: String(vmid), node, type: 'qemu', name: `vm${vmid}`, ...extra })
const group = (name: string): UsageRule => ({ type: 'group', action: name })
const direct: UsageDeps['slots'] = (_node, call) => call()

function setup(guests: CoverageGuest[], rules: Record<string, UsageRule[] | null | Error>) {
  const clock = { t: 1_000_000 }
  const fetchRules = vi.fn(async (guest: CoverageGuest) => {
    const answer = rules[guest.vmid]
    if (answer instanceof Error) throw answer

    return answer === undefined ? [] : answer
  })
  const deps: UsageDeps = { listGuests: async () => guests, fetchRules, slots: direct, now: () => clock.t }

  return { clock, fetchRules, deps }
}

beforeEach(resetGroupUsage)

describe('groupsOf', () => {
  it('names each group once, whatever the other rules, a disabled one included', () => {
    expect(groupsOf([
      { type: 'in', action: 'ACCEPT' }, group('web'), group('base'), { type: 'group', action: 'web' }, { type: 'group' }, { type: 'group', action: '' },
    ])).toEqual(['base', 'web'])
  })
})

describe('getGroupUsage', () => {
  it('lists the guests carrying each group, a group that no longer exists included', async () => {
    const { deps, fetchRules } = setup([g(101), g(102, 'pve2'), g(103)], { 101: [group('web'), group('gone')], 102: [group('web')], 103: [{ type: 'in', action: 'ACCEPT' }] })
    const { result, computing } = await getGroupUsage('c1', deps)

    expect(computing).toBe(false)
    expect(fetchRules).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ total: 3, measured: 3, unread: 0, partial: false })
    expect(result!.groups).toEqual({
      web: [{ type: 'qemu', vmid: '101', node: 'pve1', name: 'vm101' }, { type: 'qemu', vmid: '102', node: 'pve2', name: 'vm102' }],
      gone: [{ type: 'qemu', vmid: '101', node: 'pve1', name: 'vm101' }],
    })
  })

  it('asks Proxmox nothing again inside the TTL, and every guest again after it', async () => {
    const { deps, fetchRules, clock } = setup([g(101), g(102)], { 101: [group('web')] })

    await getGroupUsage('c1', deps)
    clock.t += USAGE_TTL_MS - 1
    await getGroupUsage('c1', deps)
    expect(fetchRules).toHaveBeenCalledTimes(2)
    clock.t += 1
    await getGroupUsage('c1', deps)
    expect(fetchRules).toHaveBeenCalledTimes(4)
  })

  it('reads alone the guest ProxCenter wrote to, and the guest that appeared', async () => {
    const guests = [g(101), g(102)]
    const { deps, fetchRules } = setup(guests, {})

    await getGroupUsage('c1', deps)
    forgetGroupUsage('c1', { type: 'qemu', vmid: 102 })
    guests.push(g(103))
    fetchRules.mockClear()
    await getGroupUsage('c1', deps)

    expect(fetchRules.mock.calls.map(c => c[0].vmid).sort()).toEqual(['102', '103'])
  })

  it('serves a forced read from what is kept inside the floor, and reads again past it', async () => {
    const { deps, fetchRules, clock } = setup([g(101)], {})

    await getGroupUsage('c1', deps)
    clock.t += USAGE_FORCE_MIN_MS - 1
    await getGroupUsage('c1', deps, { force: true })
    expect(fetchRules).toHaveBeenCalledTimes(1)
    clock.t += 1
    await getGroupUsage('c1', deps, { force: true })
    expect(fetchRules).toHaveBeenCalledTimes(2)
    expect(usageForceFloorMs(60_000)).toBe(600_000)
  })

  it('reads a sample above the cap and says the rest is unread; every guest when all is asked', async () => {
    const guests = Array.from({ length: USAGE_MAX_GUESTS + 50 }, (_, i) => g(1000 + i, `pve${i % 3}`))
    const { deps, fetchRules } = setup(guests, {})

    const sampled = await getGroupUsage('c1', deps)
    expect(fetchRules).toHaveBeenCalledTimes(USAGE_MAX_GUESTS)
    expect(sampled.result).toMatchObject({ total: USAGE_MAX_GUESTS + 50, measured: USAGE_MAX_GUESTS, unread: 50, partial: true })

    const all = await getGroupUsage('c1', deps, { all: true })
    // Only the 50 guests the sample left out are asked.
    expect(fetchRules).toHaveBeenCalledTimes(USAGE_MAX_GUESTS + 50)
    expect(all.result).toMatchObject({ measured: USAGE_MAX_GUESTS + 50, unread: 0, partial: false })
  })

  it('never asks a guest of an offline node, nor one whose read failed twice in one read', async () => {
    const { deps, fetchRules } = setup([g(101), g(102, 'down', { offline: true }), g(103)], { 103: new Error('boom') })
    const { result } = await getGroupUsage('c1', deps)

    expect(fetchRules.mock.calls.map(c => c[0].vmid).sort()).toEqual(['101', '103'])
    expect(result).toMatchObject({ measured: 1, unread: 2, partial: true })
  })

  it('starts no further call once one timed out, was slow, or the budget is spent', async () => {
    const guests = Array.from({ length: 8 }, (_, i) => g(200 + i))
    const clock = { t: 0 }
    const fetchRules = vi.fn(async (guest: CoverageGuest) => {
      if (guest.vmid === '200') clock.t += POOL_SLOW_CALL_MS + 1

      return []
    })
    const one: UsageDeps['slots'] = (() => {
      let chain: Promise<unknown> = Promise.resolve()

      return (_node, call) => { const next = chain.then(call); chain = next.catch(() => undefined); return next as any }
    })()
    const slow = await getGroupUsage('slow', { listGuests: async () => guests, fetchRules, slots: one, now: () => clock.t })
    expect(fetchRules).toHaveBeenCalledTimes(1)
    expect(slow.result).toMatchObject({ measured: 1, unread: 7, partial: true })

    fetchRules.mockClear()
    const late = { t: 0 }
    const budget = vi.fn(async () => { late.t += USAGE_BUDGET_MS / 2 + 1; return [] })
    await getGroupUsage('late', { listGuests: async () => guests, fetchRules: budget, slots: one, now: () => late.t }, {})
    // The slow-call rule trips first here; the budget is the second bound on the same gate.
    expect(budget.mock.calls.length).toBeLessThan(guests.length)
  })

  it('shares one read between callers, and follows a sample by the read of the rest when every guest is asked', async () => {
    const guests = Array.from({ length: USAGE_MAX_GUESTS + 3 }, (_, i) => g(3000 + i))
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => { release = resolve })
    const fetchRules = vi.fn(async () => { await held; return [] })
    const deps: UsageDeps = { listGuests: async () => guests, fetchRules, slots: direct }

    const a = getGroupUsage('c1', deps)
    const b = getGroupUsage('c1', deps)
    const c = getGroupUsage('c1', deps, { all: true })
    await Promise.resolve()
    release()
    const [ra, rb, rc] = await Promise.all([a, b, c])

    expect(ra.result).toBe(rb.result)
    expect(fetchRules).toHaveBeenCalledTimes(USAGE_MAX_GUESTS + 3)
    expect(rc.result).toMatchObject({ unread: 0 })
  })

  it('does not keep what a read saw of a guest written to meanwhile', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>(resolve => { release = resolve })
    const answers: UsageRule[][] = [[group('old')], [group('new')]]
    const fetchRules = vi.fn(async () => { await held; return answers.shift() ?? [] })
    const deps: UsageDeps = { listGuests: async () => [g(101)], fetchRules, slots: direct }

    const first = getGroupUsage('c1', deps)
    await Promise.resolve()
    await Promise.resolve()
    forgetGroupUsage('c1', { type: 'qemu', vmid: '101' })
    release()
    await first
    const second = await getGroupUsage('c1', deps)

    expect(fetchRules).toHaveBeenCalledTimes(2)
    expect(Object.keys(second.result!.groups)).toEqual(['new'])
  })

  it('tells a caller it is still computing past the wait, with the previous answer', async () => {
    const { deps, clock } = setup([g(101)], { 101: [group('web')] })
    await getGroupUsage('c1', deps)
    clock.t += USAGE_TTL_MS
    const never: UsageDeps = { ...deps, fetchRules: () => new Promise(() => undefined) }
    const outcome = await getGroupUsage('c1', never, { waitMs: 5 })

    expect(outcome.computing).toBe(true)
    expect(Object.keys(outcome.result!.groups)).toEqual(['web'])
  })

  it('reads every guest again once the engine wrote, and nothing while its mark stays', async () => {
    const { deps, fetchRules } = setup([g(101), g(102)], {})
    let mark: string | null = 'apply@1'
    const writesMark = vi.fn(async () => mark)
    const marked: UsageDeps = { ...deps, writesMark }

    await getGroupUsage('c1', marked)
    await getGroupUsage('c1', marked)
    expect(fetchRules).toHaveBeenCalledTimes(2)

    mark = 'apply@2'
    await getGroupUsage('c1', marked)
    expect(fetchRules).toHaveBeenCalledTimes(4)

    // Not known (no engine, orchestrator away, or the read threw): nothing moves, and the last mark is kept.
    mark = null
    await getGroupUsage('c1', marked)
    writesMark.mockRejectedValueOnce(new Error('away'))
    await getGroupUsage('c1', marked)
    mark = 'apply@2'
    await getGroupUsage('c1', marked)
    expect(fetchRules).toHaveBeenCalledTimes(4)
  })

  it('does not pass off as read a guest whose new read failed: it turns unread, and its old groups are dropped', async () => {
    const answers: Record<string, UsageRule[] | null | Error> = { 101: [group('web')], 102: [group('web')] }
    const { deps, clock } = setup([g(101), g(102)], answers)

    const first = await getGroupUsage('c1', deps)
    expect(first.result).toMatchObject({ measured: 2, unread: 0, partial: false })

    answers[102] = new Error('node away')
    clock.t += USAGE_FORCE_MIN_MS
    const checked = await getGroupUsage('c1', deps, { force: true, all: true })

    expect(checked.result).toMatchObject({ measured: 1, unread: 1, partial: true })
    expect(checked.result!.groups.web.map(m => m.vmid)).toEqual(['101'])
  })

  it('forgets a whole connection, and everything of a deleted one', async () => {
    const { deps, fetchRules } = setup([g(101)], {})

    await getGroupUsage('c1', deps)
    forgetGroupUsage('c1')
    await getGroupUsage('c1', deps)
    expect(fetchRules).toHaveBeenCalledTimes(2)
    evictGroupUsage('c1')
    await getGroupUsage('c1', deps)
    expect(fetchRules).toHaveBeenCalledTimes(3)
  })
})
