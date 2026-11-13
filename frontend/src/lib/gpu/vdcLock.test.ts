import { describe, expect, it } from 'vitest'

import { holdVdcLock, withVdcLock } from './vdcLock'

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('withVdcLock', () => {
  it('two calls on the same vDC run one after the other', async () => {
    let free = 1
    const take = async () => {
      const seen = free
      await tick(10)
      free = seen - 1
      return seen
    }
    const [a, b] = await Promise.all([withVdcLock('v1', take), withVdcLock('v1', take)])
    expect([a, b]).toEqual([1, 0])
  })

  it('an error releases the lock', async () => {
    const failing = withVdcLock('v2', async () => {
      throw new Error('boom')
    })
    const next = withVdcLock('v2', async () => 'ok')
    await expect(failing).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
  })

  it('different vDCs do not wait on each other', async () => {
    const order: string[] = []
    const slow = withVdcLock('a', async () => {
      await tick(30)
      order.push('a')
    })
    const fast = withVdcLock('b', async () => {
      order.push('b')
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['b', 'a'])
  })
})

describe('withVdcLock storage', () => {
  it('shares one map through globalThis across module copies', async () => {
    const map = (globalThis as any).__pcVdcGpuLocks as Map<string, unknown>
    expect(map).toBeInstanceOf(Map)
    const p = withVdcLock('shared', async () => {
      expect(map.has('shared')).toBe(true)
    })
    await p
    await tick(0)
    expect(map.has('shared')).toBe(false)
  })
})

describe('holdVdcLock', () => {
  it('holds the lock until released, then lets the next one in', async () => {
    const release = await holdVdcLock('h1')
    let ran = false
    const next = withVdcLock('h1', async () => {
      ran = true
    })
    await tick(10)
    expect(ran).toBe(false)
    release()
    await next
    expect(ran).toBe(true)
  })
})

describe('withConnGpuLock', () => {
  it('serializes the attaches of one connection, apart from the vDC locks', async () => {
    const { withConnGpuLock } = await import('./vdcLock')
    const order: string[] = []
    let release!: () => void
    const held = withConnGpuLock('c9', () => new Promise<void>((r) => (release = r)))
    const waiting = withConnGpuLock('c9', async () => {
      order.push('conn')
    })
    await withVdcLock('c9', async () => {
      order.push('vdc')
    })
    await tick(5)
    expect(order).toEqual(['vdc'])
    release()
    await Promise.all([held, waiting])
    expect(order).toEqual(['vdc', 'conn'])
  })
})
