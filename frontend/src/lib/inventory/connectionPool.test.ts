import { beforeEach, describe, expect, it } from 'vitest'

import {
  connectionPoolActivity,
  createCallGate,
  POOL_SLOW_CALL_MS,
  resetConnectionPools,
  withConnectionSlot,
} from './connectionPool'

beforeEach(() => resetConnectionPools())

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

describe('withConnectionSlot (UA52)', () => {
  it('bounds two readers of one connection together: 4 in flight, 2 per node', async () => {
    const gates = Array.from({ length: 10 }, () => deferred())
    const started: number[] = []
    // Reader A (the coverage) on n1 and n2, reader B (GET /api/v1/vms) on n1, n2 and n3.
    const nodes = ['n1', 'n1', 'n1', 'n2', 'n2', 'n2', 'n3', 'n3', 'n1', 'n3']
    const runs = nodes.map((node, i) => withConnectionSlot('c1', node, async () => {
      started.push(i)
      await gates[i].promise
    }))
    await Promise.resolve()

    expect(connectionPoolActivity('c1')).toEqual({ active: 4, waiting: 6 })
    // n1 x2, n2 x2: the third n1 waits, n3 is not reached before a slot frees.
    expect(started).toEqual([0, 1, 3, 4])

    gates[0].resolve()
    await runs[0]
    await Promise.resolve()
    // The freed n1 slot goes to the oldest waiter that may run: index 2 (n1).
    expect(started).toEqual([0, 1, 3, 4, 2])

    gates[3].resolve()
    await runs[3]
    await Promise.resolve()
    // n2's slot frees; index 5 (n2) is the oldest waiter that fits.
    expect(started).toEqual([0, 1, 3, 4, 2, 5])

    for (const g of gates) g.resolve()
    await Promise.all(runs)
    expect(connectionPoolActivity('c1')).toEqual({ active: 0, waiting: 0 })
    expect(started).toHaveLength(10)
  })

  it('lets a waiter of an idle node pass one of a full node', async () => {
    const gates = Array.from({ length: 4 }, () => deferred())
    const started: string[] = []
    const run = (node: string, i: number) => withConnectionSlot('c1', node, async () => {
      started.push(`${node}#${i}`)
      await gates[i].promise
    })
    const runs = [run('n1', 0), run('n1', 1), run('n1', 2), run('n2', 3)]
    await Promise.resolve()

    expect(started).toEqual(['n1#0', 'n1#1', 'n2#3'])
    for (const g of gates) g.resolve()
    await Promise.all(runs)
  })

  it('keeps connections apart', async () => {
    const gate = deferred()
    const runs = ['c1', 'c1', 'c2', 'c2'].map(c => withConnectionSlot(c, 'n1', () => gate.promise))
    await Promise.resolve()

    expect(connectionPoolActivity('c1').active).toBe(2)
    expect(connectionPoolActivity('c2').active).toBe(2)
    gate.resolve()
    await Promise.all(runs)
  })

  it('frees the slot when the call throws', async () => {
    await expect(withConnectionSlot('c1', 'n1', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(connectionPoolActivity('c1')).toEqual({ active: 0, waiting: 0 })
  })
})

describe('createCallGate', () => {
  it('starts no call after the deadline', async () => {
    let t = 0
    const gate = createCallGate({ deadline: 10, now: () => t })
    expect(await gate.run(async () => 'a')).toBe('a')
    t = 11
    let called = false
    expect(await gate.run(async () => { called = true; return 'b' })).toBeNull()
    expect(called).toBe(false)
  })

  it('trips on a slow answer and on a timeout, and answers null for a failure', async () => {
    let t = 0
    const slow = createCallGate({ deadline: 1e9, now: () => t })
    expect(await slow.run(async () => { t += POOL_SLOW_CALL_MS + 1; return 'late' })).toBe('late')
    expect(slow.tripped).toBe(true)
    expect(await slow.run(async () => 'x')).toBeNull()

    const timeout = createCallGate({ deadline: 1e9, now: () => 0 })
    expect(await timeout.run(async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) })).toBeNull()
    expect(timeout.tripped).toBe(true)

    const refused = createCallGate({ deadline: 1e9, now: () => 0 })
    expect(await refused.run(async () => { throw new Error('403') })).toBeNull()
    expect(refused.tripped).toBe(false)
  })
})
