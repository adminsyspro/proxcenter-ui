/**
 * The edge of the zone map on its own: the label, its click and keyboard handling, and the tooltip of details the
 * label shows on hover, for each kind of edge (allowed, outside, unprotected, blocked) and each kind of end.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { EdgeProps } from '@xyflow/react'

import { fireEvent, renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegFlow, MicrosegSuggestion } from '@/lib/microseg/types'

import { EdgeClickContext, FlowEdge, MapNamesContext, type MapNames } from './FlowEdge'
import type { MapEdgeData, MapEdgeKind } from './zoneGraph'

vi.mock('@xyflow/react', async () => (await import('./xyflowTestMock')).xyflowMock)

afterEach(cleanup)

const NAMES: MapNames = {
  zone: id => ({ zw: 'web', zd: 'db' })[id] ?? id,
  end: id => `end(${id})`,
  short: id => `short(${id})`,
}

const seen = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id, policy_id: 'p1', kind: 'would_block', src_key: 'k', src_ip: '10.0.0.1', src_zone_id: 'zw', dst_ip: '10.0.0.2', dst_zone_id: 'zd',
  proto: 'tcp', dport: '22', hits: 14, first_seen: '2026-11-02T10:00:00Z', last_seen: '2026-11-02T11:00:00Z', status: 'pending', ...over,
})

type EdgeData = MapEdgeData & { dimmed?: boolean }

const edgeData = (kind: MapEdgeKind, over: Partial<EdgeData> = {}): EdgeData => ({
  kind, services: ['tcp/22', 'tcp/443'], label: 'tcp/22, 443', count: 1, flows: [] as MicrosegFlow[], observed: [], draft: false,
  fromGroup: 'zone:zw', toGroup: 'zone:zd', path: 'M0 0 L400 0', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }],
  label_x: 200, label_y: 0, label_w: 150, label_h: 22, small: false, particle: false, color: '#2e7d32', ...over,
})

function renderEdge(source: string, target: string, data: EdgeData, onClick = vi.fn()) {
  const props = { id: 'e1', source, target, data, style: { stroke: data.color }, markerEnd: 'url(#arrow)' } as unknown as EdgeProps
  renderWithProviders(
    <EdgeClickContext.Provider value={onClick}>
      <MapNamesContext.Provider value={NAMES}>
        <svg><FlowEdge {...props} /></svg>
      </MapNamesContext.Provider>
    </EdgeClickContext.Provider>,
  )
  return onClick
}

/** Hovers the label and returns the text of the tooltip it opens. */
async function hoverDetails(label: string): Promise<string> {
  await userEvent.hover(screen.getByText(label))
  return (await screen.findByRole('tooltip')).textContent ?? ''
}

describe('the tooltip of an edge', () => {
  it('lists the grouped ports of an allowed edge', async () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed'))
    const text = await hoverDetails('tcp/22, 443')
    expect(text).toContain('Allowed: tcp/22, tcp/443')
    expect(text).not.toContain('In the draft')
  })

  it('says a draft-only allowed edge is applied with the next plan', async () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed', { draft: true }))
    expect(await hoverDetails('tcp/22, 443')).toContain('In the draft: applied with the next plan')
  })

  it('says a flow to Outside is not applied in v1', async () => {
    renderEdge('zone:zw', 'outside', edgeData('outside', { services: ['udp/53'], label: 'udp/53', color: '#9e9e9e' }))
    expect(await hoverDetails('udp/53')).toContain('Not applied in v1: udp/53')
  })

  it('shows the sample pair and the zone hits of an unprotected edge between guests', async () => {
    const observed = [seen('s1'), seen('s2', { dport: '', proto: 'icmp', hits: 1 })]
    renderEdge('guest:zw:qemu/100', 'guest:zd:qemu/200', edgeData('unprotected', { count: 2, observed, small: true, label: 'tcp/22', color: '#e53935' }))
    const text = await hoverDetails('tcp/22')
    expect(text).toContain('2 observed flows that no flow allows (unprotected)')
    expect(text).toContain('Example: short(guest:zw:qemu/100) → short(guest:zd:qemu/200)')
    expect(text).toContain('14 hits between zone web and zone db on tcp/22 (sample pair shown)')
    expect(text).toContain('1 hit between zone web and zone db on icmp (sample pair shown)')
    expect(text).toMatch(/Last seen \S/)
  })

  it('names the source address of a blocked flow from External, the unknown source too, and caps the list', async () => {
    const observed = [
      seen('s1', { kind: 'blocked', src_zone_id: '', src_ip: '203.0.113.9' }),
      seen('s2', { kind: 'blocked', src_zone_id: '', src_ip: '' }),
      ...['s3', 's4', 's5', 's6', 's7'].map(id => seen(id, { kind: 'blocked', src_zone_id: '', src_ip: '198.51.100.1', last_seen: 'not a date' })),
    ]
    renderEdge('external', 'zone:zd', edgeData('blocked', { count: 7, observed, label: 'tcp/22', color: '#1565c0' }))
    const text = await hoverDetails('tcp/22')
    expect(text).toContain('7 flows blocked by an enforced zone')
    expect(text).not.toContain('Example:')
    expect(text).toContain('14 hits from 203.0.113.9 to zone db on tcp/22')
    expect(text).toContain('14 hits from Unknown to zone db on tcp/22')
    expect(text).not.toContain('(sample pair shown)')
    expect(text).toContain('Last seen not a date')
    expect(text).toContain('+2 more')
  })
})

describe('the label of an edge', () => {
  it('names the edge for a screen reader and opens it on a click, Enter or Space', () => {
    const onClick = renderEdge('zone:zw', 'zone:zd', edgeData('allowed'))
    const label = screen.getByRole('button', { name: 'end(zone:zw) to end(zone:zd): tcp/22, tcp/443' })
    fireEvent.click(label)
    fireEvent.keyDown(label, { key: 'Enter' })
    fireEvent.keyDown(label, { key: ' ' })
    fireEvent.keyDown(label, { key: 'a' })
    expect(onClick).toHaveBeenCalledTimes(3)
    expect(onClick).toHaveBeenCalledWith('e1')
  })

  it('counts the observed flows in the name of an observed edge, and dims with its edge', () => {
    renderEdge('external', 'zone:zd', edgeData('blocked', { count: 3, label: 'tcp/22', dimmed: true }))
    const label = screen.getByRole('button', { name: 'end(external) to end(zone:zd): 3 blocked flows' })
    expect(label.classList.contains('microseg-dim')).toBe(true)
    expect(screen.getByTestId('path-e1').classList.contains('microseg-dim')).toBe(true)
  })

  it('draws a particle along an applied allowed edge', () => {
    renderEdge('zone:zw', 'zone:zd', edgeData('allowed', { particle: true }))
    expect(document.querySelector('animateMotion')?.getAttribute('path')).toBe('M0 0 L400 0')
  })
})
