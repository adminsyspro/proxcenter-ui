import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseCrushMap } from './crushRules'
import { crushClasses, crushTree, filterCrushTree, flattenCrushNodes } from './crushTree'
import type { CephOsd } from './types'

const TiB = 1024 ** 4
const map = parseCrushMap(readFileSync(join(__dirname, '__fixtures__', 'crushmap-3hosts.txt'), 'utf8'))

const osd = (id: number, host: string, over: Record<string, unknown> = {}) => ({
  id, name: `osd.${id}`, host, status: 'up', up: true, in: true, deviceClass: 'hdd', totalBytes: TiB, usedBytes: 0, availBytes: 0, usedPct: 50, ...over,
}) as unknown as CephOsd

describe('crushTree', () => {
  it('aggregates the fill weighted by size and osdUp/osdTotal up to the root', () => {
    const tree = crushTree(map.buckets, [
      osd(0, 'pve1', { totalBytes: 3 * TiB, usedPct: 80 }),
      osd(1, 'pve2', { totalBytes: TiB, usedPct: 40 }),
      osd(2, 'pve3', { totalBytes: TiB, usedPct: 20, up: false }),
    ])

    expect(tree).toHaveLength(1)

    const root = tree[0]

    expect(root).toMatchObject({ name: 'default', type: 'root', osdTotal: 3, osdUp: 2, flagged: true })
    // (3 * 0.8 + 1 * 0.4) / 4 : the down OSD reports no fill and weighs nothing
    expect(root.fillRatio).toBeCloseTo(0.7, 5)
    expect(root.children.map(c => c.name)).toEqual(['pve1', 'pve2', 'pve3'])
    expect(root.children[0]).toMatchObject({ osdTotal: 1, osdUp: 1, flagged: false, classes: ['hdd'] })
    expect(root.children[2]).toMatchObject({ osdTotal: 1, osdUp: 0, flagged: true })
    expect(root.children[0].children[0]).toMatchObject({ name: 'osd.0', type: 'osd', fillRatio: 0.8 })
  })

  it('marks an out OSD as flagged and drops devices without an OSD in the inventory', () => {
    const tree = crushTree(map.buckets, [osd(0, 'pve1', { in: false })])
    const host = tree[0].children.find(c => c.name === 'pve1')!

    expect(host.flagged).toBe(true)
    expect(tree[0].osdTotal).toBe(1)
    expect(tree[0].children.find(c => c.name === 'pve2')!.children).toEqual([])
  })

  it('class filter hides non matching osds and the buckets left empty', () => {
    const osds = [osd(0, 'pve1'), osd(1, 'pve2', { deviceClass: 'ssd' }), osd(2, 'pve3')]

    expect(crushClasses(osds)).toEqual(['hdd', 'ssd'])

    const filtered = filterCrushTree(crushTree(map.buckets, osds.filter(o => o.deviceClass === 'ssd')))
    const names = flattenCrushNodes(filtered).map(r => r.node.name)

    expect(names).toEqual(['default', 'pve2', 'osd.1'])
    expect(filtered[0]).toMatchObject({ osdTotal: 1, classes: ['ssd'] })
  })

  it('survives a loop in the map', () => {
    const looped = [
      { id: -1, name: 'a', type: 'root', children: [-2] },
      { id: -2, name: 'b', type: 'host', children: [-1] },
    ]

    expect(crushTree(looped, [])).toEqual([])
  })

  it('flattens only the unfolded branches', () => {
    const tree = crushTree(map.buckets, [osd(0, 'pve1'), osd(1, 'pve2'), osd(2, 'pve3')])
    const rows = flattenCrushNodes(tree, new Set(['-1']))

    expect(rows.map(r => r.node.name)).toEqual(['default', 'pve1', 'pve2', 'pve3'])
    expect(rows.map(r => r.depth)).toEqual([0, 1, 1, 1])
    expect(flattenCrushNodes(tree)).toHaveLength(7)
  })
})

