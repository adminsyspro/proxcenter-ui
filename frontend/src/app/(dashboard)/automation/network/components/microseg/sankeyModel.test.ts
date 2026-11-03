/**
 * The Sankey layout is pure: sources on the left, destinations on the right, a ribbon per pair and kind, the
 * observed ones as wide as the square root of their hits, the allowed ones thin, every node as tall as its ribbons.
 */

import { describe, expect, it } from 'vitest'

import { demoInput, flow, seen, zone } from './mapViewsTestKit'
import { buildMatrix } from './matrixModel'
import { ALLOWED_W, MAX_W, MIN_W, NODE_GAP, buildSankey, ribbonWidth } from './sankeyModel'
import { ALL_FLOWS } from './zoneGraph'

const web = zone('zw', 'web')
const db = zone('zd', 'db')
const app = zone('za', 'app')

describe('ribbonWidth', () => {
  it('follows the square root of the hits, the busiest at the widest, never under the minimum', () => {
    expect(ribbonWidth(100, 100)).toBe(MAX_W)
    expect(ribbonWidth(25, 100)).toBe(MAX_W / 2)
    expect(ribbonWidth(0, 100)).toBe(MIN_W)
    expect(ribbonWidth(1, 1_000_000)).toBe(MIN_W)
    expect(ribbonWidth(5, 0)).toBe(MIN_W)
  })
})

describe('buildSankey', () => {
  const matrix = buildMatrix({
    zones: [web, db, app],
    flows: [flow('f1'), flow('f2', { src_zone_id: 'za', dst_zone_id: 'zd' }), flow('f3', { dst_zone_id: '', dst_cidr: '10.0.0.0/8' })],
    suggestions: [
      seen('s1', { hits: 100 }),
      seen('s2', { kind: 'blocked', hits: 25 }),
      seen('s3', { src_zone_id: 'za', dst_zone_id: 'zw', hits: 4 }),
      seen('s4', { src_zone_id: '', src_ip: '10.9.0.1', dst_zone_id: 'za', hits: 9 }),
    ],
  })
  const layout = buildSankey(matrix, ALL_FLOWS)

  it('draws a ribbon per pair and kind, observed ones by their hits, allowed ones thin', () => {
    const byId = new Map(layout.ribbons.map(r => [r.id, r]))
    expect([...byId.keys()].sort()).toEqual([
      'allowed:cell:zone:za>zone:zd',
      'allowed:cell:zone:zw>zone:zd',
      'blocked:cell:zone:zw>zone:zd',
      'outside:cell:zone:zw>outside',
      'unprotected:cell:external>zone:za',
      'unprotected:cell:zone:za>zone:zw',
      'unprotected:cell:zone:zw>zone:zd',
    ])
    expect(byId.get('unprotected:cell:zone:zw>zone:zd')).toMatchObject({ width: MAX_W, hits: 100, count: 1, cell: 'cell:zone:zw>zone:zd' })
    expect(byId.get('blocked:cell:zone:zw>zone:zd')!.width).toBe(MAX_W / 2)
    expect(byId.get('allowed:cell:zone:zw>zone:zd')).toMatchObject({ width: ALLOWED_W, hits: 0, count: 1, services: ['tcp/443'] })
  })

  it('orders the nodes by hits, then by name', () => {
    expect(layout.sources.map(n => n.id)).toEqual(['zone:zw', 'external', 'zone:za'])
    expect(layout.targets.map(n => n.id)).toEqual(['zone:zd', 'zone:za', 'zone:zw', 'outside'])
    expect(layout.sources[0]).toMatchObject({ hits: 125, zone: web })
  })

  it('stacks the nodes with a gap, each as tall as its ribbons, the ribbons side by side inside it', () => {
    for (const side of [layout.sources, layout.targets]) {
      let top = 0
      for (const n of side) {
        expect(n.y, n.id).toBe(top)
        const own = layout.ribbons.filter(r => (side === layout.sources ? r.source : r.target) === n.id)
        const ends = own.map(r => (side === layout.sources ? r.y0 : r.y1)).sort((a, b) => a - b)
        expect(own.reduce((s, r) => s + r.width, 0), n.id).toBeCloseTo(n.height)
        expect(ends[0], n.id).toBe(n.y)
        top = n.y + n.height + NODE_GAP
      }
    }
    expect(layout.height).toBe(Math.max(...[...layout.sources, ...layout.targets].map(n => n.y + n.height)))
  })

  it('orders the ribbons of a node by the other end, then unprotected, blocked, allowed', () => {
    const atWeb = layout.ribbons.filter(r => r.source === 'zone:zw').sort((a, b) => a.y0 - b.y0).map(r => r.id)
    expect(atWeb).toEqual(['unprotected:cell:zone:zw>zone:zd', 'blocked:cell:zone:zw>zone:zd', 'allowed:cell:zone:zw>zone:zd', 'outside:cell:zone:zw>outside'])
  })

  it('follows the checkboxes', () => {
    const observedOnly = buildSankey(matrix, { ...ALL_FLOWS, allowed: false })
    expect(observedOnly.ribbons.every(r => r.kind === 'unprotected' || r.kind === 'blocked')).toBe(true)
    expect(observedOnly.targets.some(n => n.id === 'outside')).toBe(false)
    const blockedOnly = buildSankey(matrix, { allowed: false, unprotected: false, blocked: true })
    expect(blockedOnly.ribbons.map(r => r.id)).toEqual(['blocked:cell:zone:zw>zone:zd'])
    expect(blockedOnly.ribbons[0].width).toBe(MAX_W)
    expect(buildSankey(matrix, { allowed: false, unprotected: false, blocked: false })).toEqual({ sources: [], targets: [], ribbons: [], height: 0 })
  })

  it('is deterministic on the demo-like draft', () => {
    const input = demoInput()
    const a = buildSankey(buildMatrix(input), ALL_FLOWS)
    const b = buildSankey(buildMatrix({ ...input, zones: [...input.zones].reverse(), flows: [...input.flows].reverse(), suggestions: [...input.suggestions].reverse() }), ALL_FLOWS)
    expect(b).toEqual(a)
    expect(a.sources[0].id).toBe('zone:zw')
  })
})
