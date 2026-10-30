import { beforeEach, describe, expect, it } from 'vitest'

import { DAEMON_SLOTS_PER_NODE, DaemonSlotExpired, daemonNodeKey, resetDaemonSlots, withDaemonSlot } from './daemonSlots'

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })

  return { promise, resolve, reject }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => resetDaemonSlots())

describe('withDaemonSlot', () => {
  it('keeps at most DAEMON_SLOTS_PER_NODE calls in flight on a node, in arrival order', async () => {
    const gates = Array.from({ length: 5 }, () => deferred())
    const started: number[] = []
    let inFlight = 0
    let peak = 0
    const runs = gates.map((gate, i) => withDaemonSlot('c1/pve1', async () => {
      started.push(i)
      peak = Math.max(peak, ++inFlight)
      await gate.promise
      inFlight--

      return i
    }))

    await tick()
    expect(started).toEqual([0, 1])
    gates[1].resolve()
    await tick()
    expect(started).toEqual([0, 1, 2])
    gates.forEach(g => g.resolve())
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(DAEMON_SLOTS_PER_NODE)
  })

  it('gives every node its own slots', async () => {
    const gate = deferred()
    const started: string[] = []
    const runs = ['c1/pve1', 'c1/pve1', 'c1/pve2', 'c2/pve1'].map(key => withDaemonSlot(key, async () => { started.push(key); await gate.promise }))

    await tick()
    expect(started).toEqual(['c1/pve1', 'c1/pve1', 'c1/pve2', 'c2/pve1'])
    gate.resolve()
    await Promise.all(runs)
  })

  it('frees the slot of a call that failed', async () => {
    await expect(withDaemonSlot('c1/pve1', async () => { throw new Error('596') })).rejects.toThrow('596')
    await expect(withDaemonSlot('c1/pve1', async () => { throw new Error('596') })).rejects.toThrow('596')
    expect(await withDaemonSlot('c1/pve1', async () => 'ok')).toBe('ok')
  })

  it('never sends a call whose slot came after its deadline, and hands the slot on', async () => {
    let clock = 1_000
    const now = () => clock
    const gates = [deferred(), deferred()]
    const busy = gates.map(g => withDaemonSlot('c1/pve1', () => g.promise))
    let sent = false
    const late = withDaemonSlot('c1/pve1', async () => { sent = true }, { deadline: 1_500, now })
    const after = withDaemonSlot('c1/pve1', async () => 'next')

    clock = 2_000
    gates[0].resolve()
    await expect(late).rejects.toBeInstanceOf(DaemonSlotExpired)
    expect(sent).toBe(false)
    expect(await after).toBe('next')
    gates[1].resolve()
    await Promise.all(busy)
  })
})

describe('daemonNodeKey', () => {
  it('keys a node by connection id, or by base URL without one', () => {
    expect(daemonNodeKey({ id: 'c1', baseUrl: 'https://a' }, 'pve1')).toBe('c1/pve1')
    expect(daemonNodeKey({ baseUrl: 'https://a' }, 'pve1')).toBe('https://a/pve1')
  })
})
