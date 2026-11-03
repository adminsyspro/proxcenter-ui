/**
 * The matrix of the zones is pure: sources (zones, then Unknown / External) by destinations (zones, then Outside),
 * each cell the allowed and observed flows of its pair, its tone and hits following the three flow checkboxes.
 */

import { describe, expect, it } from 'vitest'

import { demoInput, flow, seen, zone } from './mapViewsTestKit'
import { buildMatrix, cellEdgeData, cellId, cellView, matrixEdge, sortEnds } from './matrixModel'
import { ALL_FLOWS, EDGE_COLORS } from './zoneGraph'

const web = zone('zw', 'web')
const db = zone('zd', 'db')

describe('buildMatrix', () => {
  it('has a row per zone and Unknown / External, a column per zone and Outside', () => {
    const m = buildMatrix({ zones: [web, db], flows: [], suggestions: [] })
    expect(m.rows.map(r => r.id)).toEqual(['zone:zd', 'zone:zw', 'external'])
    expect(m.cols.map(c => c.id)).toEqual(['zone:zd', 'zone:zw', 'outside'])
    expect(m.rows[0].zone).toBe(db)
    expect(m.cells.size).toBe(0)
  })

  it('puts each allowed flow in the cell of its pair, a CIDR source in External, a CIDR destination in Outside', () => {
    const m = buildMatrix({
      zones: [web, db],
      flows: [flow('f1'), flow('f2', { dport: '22' }), flow('f3', { src_zone_id: '', src_cidr: '0.0.0.0/0' }), flow('f4', { dst_zone_id: '', dst_cidr: '10.9.0.0/16' }), flow('f5', { src_zone_id: 'gone' }), flow('f6', { src_zone_id: '', src_cidr: '1.0.0.0/8', dst_zone_id: '', dst_cidr: '2.0.0.0/8' })],
      suggestions: [],
    })
    expect(m.cells.get(cellId('zone:zw', 'zone:zd'))!.flows.map(f => f.id)).toEqual(['f1', 'f2'])
    expect(m.cells.get(cellId('external', 'zone:zd'))!.flows.map(f => f.id)).toEqual(['f3'])
    expect(m.cells.get(cellId('zone:zw', 'outside'))!.flows.map(f => f.id)).toEqual(['f4'])
    expect(m.cells.size).toBe(3)
  })

  it('puts the pending observed flows in their pair, a source in no zone in External', () => {
    const m = buildMatrix({
      zones: [web, db],
      flows: [],
      suggestions: [seen('s1'), seen('s2', { kind: 'blocked', src_zone_id: '', src_ip: '10.9.0.1' }), seen('s3', { status: 'accepted' }), seen('s4', { dst_zone_id: 'gone' })],
    })
    expect(m.cells.get(cellId('zone:zw', 'zone:zd'))!.observed.map(s => s.id)).toEqual(['s1'])
    expect(m.cells.get(cellId('external', 'zone:zd'))!.observed.map(s => s.id)).toEqual(['s2'])
    expect(m.cells.size).toBe(2)
  })
})

describe('cellView', () => {
  const m = buildMatrix({
    zones: [web, db],
    flows: [flow('f1'), flow('f2', { proto: 'udp', dport: '53' })],
    suggestions: [seen('s1', { hits: 5 }), seen('s2', { kind: 'blocked', dport: '22', hits: 7 })],
  })
  const cell = m.cells.get(cellId('zone:zw', 'zone:zd'))

  it('lists the allowed services, counts the observed flows and their hits, red when unprotected traffic was seen', () => {
    const v = cellView(cell, ALL_FLOWS, null)!
    expect(v.services).toEqual(['tcp/443', 'udp/53'])
    expect(v).toMatchObject({ unprotected: 1, blocked: 1, hits: 12, tone: 'unprotected', draft: false })
  })

  it('lists the observed services of the pair, unprotected first, their hits summed per service', () => {
    const m2 = buildMatrix({ zones: [web, db], flows: [], suggestions: [seen('a', { kind: 'blocked', dport: '22', hits: 2 }), seen('b', { hits: 4 }), seen('c', { hits: 6, src_ip: '10.0.0.9' })] })
    expect(cellView(m2.cells.get(cellId('zone:zw', 'zone:zd')), ALL_FLOWS, null)!.observedChips).toEqual([
      { service: 'tcp/80', kind: 'unprotected', hits: 10 },
      { service: 'tcp/22', kind: 'blocked', hits: 2 },
    ])
  })

  it('follows the checkboxes: blue when only the blocked flows are kept, green when only the allowed ones', () => {
    expect(cellView(cell, { ...ALL_FLOWS, unprotected: false }, null)).toMatchObject({ tone: 'blocked', hits: 7, unprotected: 0 })
    expect(cellView(cell, { allowed: true, unprotected: false, blocked: false }, null)).toMatchObject({ tone: 'allowed', hits: 0 })
    expect(cellView(cell, { allowed: false, unprotected: true, blocked: true }, null)!.services).toEqual([])
    expect(cellView(cell, { allowed: false, unprotected: false, blocked: false }, null)).toBeNull()
    expect(cellView(undefined, ALL_FLOWS, null)).toBeNull()
  })

  it('marks a cell whose flows are all in the draft only', () => {
    expect(cellView(cell, ALL_FLOWS, new Set(['f1', 'f2']))!.draft).toBe(true)
    expect(cellView(cell, ALL_FLOWS, new Set(['f1']))!.draft).toBe(false)
  })

  it('gives the flow panel the pair: its flows, its observed flows, the kind and colour of the tone', () => {
    const d = cellEdgeData(cellView(cell, ALL_FLOWS, null)!, 'zone:zd')
    expect(d).toMatchObject({ kind: 'unprotected', color: EDGE_COLORS.unprotected, label: 'SSH, HTTP, HTTPS · DNS' })
    expect(d.flows.map(f => f.id)).toEqual(['f1', 'f2'])
    expect(d.observed.map(s => s.id)).toEqual(['s1', 's2'])
    const outside = buildMatrix({ zones: [web], flows: [flow('f9', { dst_zone_id: '', dst_cidr: '10.0.0.0/8' })], suggestions: [] })
    expect(cellEdgeData(cellView(outside.cells.get(cellId('zone:zw', 'outside')), ALL_FLOWS, null)!, 'outside').kind).toBe('outside')
  })
})

describe('matrixEdge', () => {
  it('gives the panel the pair of a cell, nothing for a cell that is gone or hidden by the checkboxes', () => {
    const m = buildMatrix({ zones: [web, db], flows: [flow('f1')], suggestions: [] })
    const id = cellId('zone:zw', 'zone:zd')
    expect(matrixEdge(m, id, ALL_FLOWS, null)).toMatchObject({ id, source: 'zone:zw', target: 'zone:zd', data: { kind: 'allowed' } })
    expect(matrixEdge(m, id, { ...ALL_FLOWS, allowed: false }, null)).toBeNull()
    expect(matrixEdge(m, 'cell:x>y', ALL_FLOWS, null)).toBeNull()
  })
})

describe('sortEnds', () => {
  const { zones, flows, suggestions } = demoInput()
  const m = buildMatrix({ zones, flows, suggestions })

  it('sorts the zones by name, External last among the sources and Outside last among the destinations', () => {
    expect(sortEnds(m.rows, 'name').map(r => r.id)).toEqual(['zone:zad', 'zone:za', 'zone:zc', 'zone:zd', 'zone:zm', 'zone:zw', 'external'])
    expect(sortEnds(m.cols, 'name').at(-1)!.id).toBe('outside')
  })

  it('sorts the zones by layer, as the map reads left to right, External first', () => {
    const ids = sortEnds(m.rows, 'layer').map(r => r.id)
    expect(ids[0]).toBe('external')
    expect(ids.indexOf('zone:zw')).toBeLessThan(ids.indexOf('zone:za'))
    expect(ids.indexOf('zone:zm')).toBeLessThan(ids.indexOf('zone:za'))
    expect(ids.indexOf('zone:za')).toBeLessThan(ids.indexOf('zone:zd'))
    expect(ids.indexOf('zone:za')).toBeLessThan(ids.indexOf('zone:zc'))
    expect(sortEnds(m.cols, 'layer').at(-1)!.id).toBe('outside')
  })
})
