/**
 * Coverage for the pure React Flow graph builder used by micro-segmentation.
 *
 * The fixed three-column geometry, selection highlighting, endpoint cards,
 * edge wiring, and search retention rules are what make the canvas truthful.
 * These tests inspect graph data directly and need no DOM or JSX.
 */

import { describe, expect, it } from 'vitest'

import type { EastWestFlow, EastWestGuest } from '@/lib/firewall/eastWest'

import { buildFlowGraph, guestMatchesQuery, MS_COL_GAP, MS_LANE_PAD, MS_RULE_W, MS_VM_W } from './buildFlowGraph'

const guest = (vmid: number, name: string, ip: string): EastWestGuest => ({
  vmid, name, node: 'pve1', type: 'qemu', status: 'running', ips: ip ? [ip] : [],
  firewallEnabled: true, rules: [],
})

const WEB = guest(100, 'web-01', '10.0.0.10')
const DB = guest(101, 'db-01', '10.0.0.20')
const CACHE = guest(102, 'cache-01', '10.0.0.30')

const flow = (source: EastWestFlow['source'], dest: EastWestFlow['dest'], overrides: Partial<EastWestFlow> = {}): EastWestFlow => ({
  source, dest, origins: [{ vmid: 100, side: 'out', pos: 0 }], ...overrides,
})

const build = (overrides: Partial<Parameters<typeof buildFlowGraph>[0]> = {}) => buildFlowGraph({
  guests: [WEB, DB, CACHE],
  flows: [],
  selection: null,
  query: '',
  colors: { edge: '#00aa00' },
  ...overrides,
})

const node = (nodes: ReturnType<typeof buildFlowGraph>['nodes'], id: string) => nodes.find(n => n.id === id)!

describe('buildFlowGraph', () => {
  it('always draws the three swim-lanes behind their columns', () => {
    const { nodes } = build()
    const lanes = ['lane-src', 'lane-flow', 'lane-dst'].map(id => node(nodes, id))

    expect(lanes.map(n => n.type)).toEqual(['msLane', 'msLane', 'msLane'])
    expect(lanes.every(n => n.position.y < 0)).toBe(true)
    expect(lanes.every(n => n.zIndex === -10)).toBe(true)
    // Lanes are visual only: cards stay clickable and the pane keeps panning.
    expect(lanes.every(n => n.style?.pointerEvents === 'none')).toBe(true)
    expect(lanes.map(n => n.position.x)).toEqual([
      -MS_LANE_PAD,
      MS_VM_W + MS_COL_GAP - MS_LANE_PAD,
      MS_VM_W + MS_COL_GAP + MS_RULE_W + MS_COL_GAP - MS_LANE_PAD,
    ])
    expect(lanes.map(n => (n.data as any).labelKey)).toEqual(['sourceVms', 'allowedConnections', 'destinationVms'])
    expect(lanes.map(n => (n.data as any).count)).toEqual([3, 0, 3])
  })

  it('shows every guest in both outside columns and a hint when unselected', () => {
    const { nodes, edges } = build()

    for (const vmid of [100, 101, 102]) {
      expect(node(nodes, `src-${vmid}`).position.x).toBe(0)
      expect(node(nodes, `dst-${vmid}`).position.x).toBe(MS_VM_W + MS_COL_GAP + MS_RULE_W + MS_COL_GAP)
    }
    expect(node(nodes, 'ms-hint').data).toMatchObject({ variant: 'hint' })
    expect(edges).toEqual([])
  })

  it('draws the whole traffic shape as thin overview edges when unselected', () => {
    const flows = [
      flow({ kind: 'vm', vmid: 100 }, { kind: 'vm', vmid: 101 }, { proto: 'tcp', dport: '443' }),
      // Same pair again with another service: one overview edge only.
      flow({ kind: 'vm', vmid: 100 }, { kind: 'vm', vmid: 101 }, { proto: 'tcp', dport: '5432' }),
      // Endpoints that are not resolved guests stay out of the overview.
      flow({ kind: 'vm', vmid: 100 }, { kind: 'any' }),
    ]
    const { nodes, edges } = build({ flows })

    expect(edges.map(e => [e.source, e.target])).toEqual([['src-100', 'dst-101']])
    // Overview edges are dimmed and carry no moving packet.
    expect(edges[0].data).toEqual({})
    expect((node(nodes, 'lane-flow').data as any).count).toBe(3)
  })

  it('sends the moving packet down detail edges only', () => {
    const flows = [flow({ kind: 'vm', vmid: 100 }, { kind: 'vm', vmid: 101 })]
    const { edges } = build({ flows, selection: { side: 'source', vmid: 100 } })

    expect(edges.every(e => e.type === 'flowEdge')).toBe(true)
    expect(edges.every(e => (e.data as any).particle === true)).toBe(true)
  })

  it('renders two edges per source flow and highlights only involved cards', () => {
    const flows = [
      flow({ kind: 'vm', vmid: 100 }, { kind: 'vm', vmid: 101 }, { proto: 'tcp', dport: '443' }),
      flow({ kind: 'vm', vmid: 100 }, { kind: 'vm', vmid: 102 }, { macro: 'PING' }),
    ]
    const { nodes, edges } = build({ flows, selection: { side: 'source', vmid: 100 } })

    expect(nodes.filter(n => n.id.startsWith('flow-')).map(n => n.id)).toEqual(['flow-0', 'flow-1'])
    expect(edges).toHaveLength(4)
    expect(edges.map(e => [e.source, e.target])).toEqual([
      ['src-100', 'flow-0'], ['flow-0', 'dst-101'],
      ['src-100', 'flow-1'], ['flow-1', 'dst-102'],
    ])
    expect(node(nodes, 'ms-add-rule').data).toMatchObject({ variant: 'addRule' })
    expect(node(nodes, 'src-100').data).toMatchObject({ selected: true, dimmed: false })
    expect(node(nodes, 'dst-101').data).toMatchObject({ selected: false, dimmed: false })
    expect(node(nodes, 'src-101').data).toMatchObject({ selected: false, dimmed: false })
    expect(node(nodes, 'src-999')).toBeUndefined()
  })

  it('dims guests uninvolved with a source selection', () => {
    const flows = [flow({ kind: 'vm', vmid: 100 }, { kind: 'vm', vmid: 101 })]
    const { nodes } = build({ flows, selection: { side: 'source', vmid: 100 } })

    expect(node(nodes, 'dst-101').data).toMatchObject({ dimmed: false })
    expect(node(nodes, 'src-102').data).toMatchObject({ dimmed: true })
    expect(node(nodes, 'dst-102').data).toMatchObject({ dimmed: true })
  })

  it('uses destination filtering for an IN-derived flow', () => {
    const inbound = flow(
      { kind: 'vm', vmid: 100 },
      { kind: 'vm', vmid: 101 },
      { origins: [{ vmid: 101, side: 'in', pos: 4 }] },
    )
    const { nodes, edges } = build({ flows: [inbound], selection: { side: 'dest', vmid: 101 } })

    expect(node(nodes, 'dst-101').data).toMatchObject({ selected: true })
    // Origins carry the carrier guest's name so the card can label the rule.
    expect(node(nodes, 'flow-0').data).toMatchObject({ origins: [{ vmid: 101, side: 'in', pos: 4, name: 'db-01' }] })
    expect(edges).toHaveLength(2)
  })

  it('mints cards for any and unresolved destination endpoints', () => {
    const flows = [
      flow({ kind: 'vm', vmid: 100 }, { kind: 'any' }),
      flow({ kind: 'vm', vmid: 100 }, { kind: 'ref', ref: 'outside-net' }),
    ]
    const { nodes } = build({ flows, selection: { side: 'source', vmid: 100 } })

    expect(node(nodes, 'dst-any').data).toMatchObject({ variant: 'any', side: 'dest' })
    expect(node(nodes, 'dst-ref-1').data).toMatchObject({ variant: 'ref', ref: 'outside-net', side: 'dest' })
  })

  it('matches search by name, vmid, and IP', () => {
    expect(guestMatchesQuery(WEB, 'WEB')).toBe(true)
    expect(guestMatchesQuery(WEB, '100')).toBe(true)
    expect(guestMatchesQuery(WEB, '0.0.10')).toBe(true)
    expect(guestMatchesQuery(WEB, 'database')).toBe(false)
  })

  it('hides search misses but retains the selected and involved guests', () => {
    const flows = [flow({ kind: 'vm', vmid: 100 }, { kind: 'vm', vmid: 101 })]
    const { nodes } = build({ flows, selection: { side: 'source', vmid: 100 }, query: 'no-match' })

    expect(node(nodes, 'src-100')).toBeDefined()
    expect(node(nodes, 'dst-101')).toBeDefined()
    expect(node(nodes, 'src-102')).toBeUndefined()
  })

  it('narrows both columns to the VM picker working set', () => {
    const { nodes } = build({ vmidFilter: new Set([100, 102]) })

    expect(node(nodes, 'src-100')).toBeDefined()
    expect(node(nodes, 'dst-102')).toBeDefined()
    expect(node(nodes, 'src-101')).toBeUndefined()
    expect(node(nodes, 'dst-101')).toBeUndefined()
  })

  it('keeps a guest outside the working set when the selection flows to it', () => {
    const flows = [flow({ kind: 'vm', vmid: 100 }, { kind: 'vm', vmid: 101 }, { proto: 'tcp', dport: '443' })]
    const { nodes, edges } = build({ flows, selection: { side: 'source', vmid: 100 }, vmidFilter: new Set([100]) })

    // db-01 is outside the picked set, but the flow needs its destination card.
    expect(node(nodes, 'dst-101')).toBeDefined()
    expect(edges).toHaveLength(2)
  })

  it('combines the picker with the search: a guest must pass both', () => {
    const { nodes } = build({ query: 'web', vmidFilter: new Set([100, 101]) })

    expect(node(nodes, 'src-100')).toBeDefined()
    expect(node(nodes, 'src-101')).toBeUndefined()
    expect(node(nodes, 'src-102')).toBeUndefined()
  })
})
