import { afterEach, describe, expect, it, vi } from 'vitest'

import { __heldVmids, releaseVmids, reserveVmid } from './vmid-reservation'

// A cluster whose /cluster/nextid answers like PVE: the lowest free id, or n
// itself when asked about a free n, an error when n is taken.
function cluster(taken: number[], delayMs = 0) {
  const used = new Set(taken)
  const nextId = vi.fn(async (from?: number) => {
    if (delayMs) await new Promise(r => setTimeout(r, delayMs))
    if (from !== undefined) {
      if (used.has(from)) throw new Error(`VM ${from} already exists`)
      return from
    }
    let id = 100
    while (used.has(id)) id++
    return id
  })
  return { nextId, used }
}

afterEach(() => {
  for (const j of ['j1', 'j2', 'j3', 'j4']) releaseVmids(j)
})

describe('reserveVmid (roadmap#53)', () => {
  it('gives the jobs of a parallel batch distinct ids, though the cluster answers the same to all', async () => {
    const { nextId } = cluster([100, 101], 5)
    const ids = await Promise.all(['j1', 'j2', 'j3'].map(j => reserveVmid('c1', j, nextId)))
    expect(ids).toEqual([102, 103, 104])
    expect(__heldVmids('c1')).toEqual([102, 103, 104])
  })

  it('skips ids taken on the cluster while looking past the held ones', async () => {
    const { nextId } = cluster([100])
    expect(await reserveVmid('c1', 'j1', nextId)).toBe(101)
    // 102 and 103 appeared on the cluster meanwhile (created by hand)
    const c = cluster([100, 102, 103])
    expect(await reserveVmid('c1', 'j2', c.nextId)).toBe(104)
  })

  it('keeps clusters apart and frees a job\'s ids when it ends', async () => {
    const { nextId } = cluster([])
    expect(await reserveVmid('c1', 'j1', nextId)).toBe(100)
    expect(await reserveVmid('c2', 'j2', nextId)).toBe(100)
    expect(await reserveVmid('c1', 'j3', nextId)).toBe(101)
    releaseVmids('j1')
    expect(__heldVmids('c1')).toEqual([101])
    expect(await reserveVmid('c1', 'j4', nextId)).toBe(100)
  })

  it('refuses an answer that is not a VMID instead of reserving it', async () => {
    await expect(reserveVmid('c1', 'j1', vi.fn().mockResolvedValue('oops'))).rejects.toThrow('Unexpected /cluster/nextid answer: oops')
    expect(__heldVmids('c1')).toEqual([])
  })

  it('a failing cluster call does not block the next reservation', async () => {
    const nextId = vi.fn().mockRejectedValueOnce(new Error('PVE down')).mockResolvedValue(100)
    await expect(reserveVmid('c1', 'j1', nextId)).rejects.toThrow('PVE down')
    expect(await reserveVmid('c1', 'j2', nextId)).toBe(100)
  })
})
