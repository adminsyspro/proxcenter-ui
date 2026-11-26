/**
 * The busiest addresses behind the Unknown / External box of the map, told by its tooltip: summed per source address
 * from the observed flows drawn from it, the same on the guest-to-guest rendering (one entry per pair) and on the
 * constellation (the row whole), without the pairs another end of the map draws.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { buildConstellationGraph } from './constellationGraph'
import { ExternalSourcesContext, externalSources } from './externalSources'
import { ExternalTip } from './ZoneNode'
import { buildZoneGraph, type MapMember } from './zoneGraph'

const db: MicrosegZone = {
  id: 'zd', policy_id: 'p1', name: 'db', label: '', color: '#3b82f6', enforcement: 'guest', vnet_id: '', state: 'observe',
  isolate_members: false, observe_since: null,
}

const seen = (id: string, over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
  id, policy_id: 'p1', connection_id: 'c1', kind: 'would_block', src_key: 'k', src_ip: '', src_zone_id: '', dst_ip: '10.0.4.2', dst_zone_id: 'zd',
  proto: 'tcp', dport: '3306', hits: 3, first_seen: '2026-11-02T10:00:00Z', last_seen: '2026-11-02T11:00:00Z', status: 'pending', ...over,
})

const member = (vmid: number, name: string, ips: string[]): MapMember => ({
  key: `qemu/${vmid}`, name, vmid, node: 'pve1', type: 'qemu', status: 'running', ips, pending: false,
})

// From outside into db: three addresses on the internet, one guest in no zone.
const fromOutside = seen('s1', {
  src_ip: '203.0.113.7', hits: 20,
  pairs: [
    { src_ip: '203.0.113.7', dst_ip: '10.0.4.2', hits: 9 },
    { src_ip: '198.51.100.4', dst_ip: '10.0.4.2', hits: 6 },
    { src_ip: '10.0.9.9', dst_ip: '10.0.4.2', hits: 3 },
  ],
})
const other = seen('s2', { src_ip: '198.51.100.4', hits: 5, dport: '22' })
const input = {
  zones: [db], flows: [], suggestions: [fromOutside, other],
  members: new Map([['zd', [member(102, 'db-1', ['10.0.4.2'])]]]),
  unzoned: [member(150, 'tools', ['10.0.9.9'])],
}

const unzonedIps = new Set(['10.0.9.9'])

describe('the addresses behind Unknown / External', () => {
  it('sums the hits per address on the guest-to-guest rendering, without the guest in no zone, the busiest first', () => {
    const graph = buildZoneGraph(input)
    // The rest of the row (2 hits no pair holds) stays on its sample address, as the map draws it.
    expect(externalSources(graph.edges, input.suggestions, unzonedIps)).toEqual({
      top: [{ ip: '198.51.100.4', hits: 11 }, { ip: '203.0.113.7', hits: 11 }],
      count: 2,
    })
  })

  it('counts a row drawn whole (the constellation) once, from its pairs, the guest in no zone left out', () => {
    const graph = buildConstellationGraph(input)
    expect(externalSources(graph.edges, input.suggestions, unzonedIps)).toEqual({
      top: [{ ip: '198.51.100.4', hits: 11 }, { ip: '203.0.113.7', hits: 11 }],
      count: 2,
    })
  })

  it('keeps the ten busiest, says how many there are, and nothing when no edge leaves External', () => {
    const many = Array.from({ length: 12 }, (_, i) => seen(`m${i}`, { src_ip: `192.0.2.${i + 1}`, hits: i + 1 }))
    const graph = buildZoneGraph({ ...input, suggestions: many })
    const sources = externalSources(graph.edges, many, unzonedIps)
    expect(sources?.count).toBe(12)
    expect(sources?.top.map(s => s.ip)).toEqual(['192.0.2.12', '192.0.2.11', '192.0.2.10', '192.0.2.9', '192.0.2.8', '192.0.2.7', '192.0.2.6', '192.0.2.5', '192.0.2.4', '192.0.2.3'])
    const inside = seen('i1', { src_zone_id: 'zd', src_ip: '10.0.4.2' })
    expect(externalSources(buildZoneGraph({ ...input, suggestions: [inside] }).edges, [inside], unzonedIps)).toBeNull()
  })
})

describe('the tooltip of Unknown / External', () => {
  afterEach(cleanup)

  it('lists the busiest addresses with their hits under what the box stands for', () => {
    renderWithProviders(
      <ExternalSourcesContext.Provider value={{ top: [{ ip: '198.51.100.4', hits: 1200 }, { ip: '203.0.113.7', hits: 11 }], count: 14 }}>
        <ExternalTip />
      </ExternalSourcesContext.Provider>,
    )
    expect(screen.getByText('Sources that match no guest: an IP address or a network (CIDR)')).toBeTruthy()
    expect(screen.getByText('The busiest addresses, 2 of 14')).toBeTruthy()
    const lines = [...document.querySelectorAll('[data-source-ip]')].map(e => e.textContent)
    expect(lines).toEqual(['198.51.100.41,200', '203.0.113.711'])
  })

  it('says only what the box stands for when the map draws no address from it', () => {
    renderWithProviders(<ExternalTip />)
    expect(screen.getByText('Sources that match no guest: an IP address or a network (CIDR)')).toBeTruthy()
    expect(screen.queryByTestId('external-tip')).toBeNull()
  })
})
