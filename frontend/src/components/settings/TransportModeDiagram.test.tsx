/**
 * TransportModeDiagram (#899): the drawing of a transport mode. One box per
 * node with the address it contributes, dashed boxes for endpoints outside
 * the cluster, a "+N" box when the cluster does not fit, and a bottom band
 * naming the network the tunnels ride on.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import TransportModeDiagram, { TRANSPORT_MODE_KEYS } from '@/components/settings/TransportModeDiagram'

afterEach(cleanup)

const NODES = [
  { name: 'pve1', address: '203.0.113.11' },
  { name: 'pve2', address: '203.0.113.12' },
]

describe('TransportModeDiagram', () => {
  it('exposes the copy keys of the three modes', () => {
    expect(Object.keys(TRANSPORT_MODE_KEYS).sort((a, b) => a.localeCompare(b))).toEqual(['cluster', 'peers', 'transport'])
    for (const copy of Object.values(TRANSPORT_MODE_KEYS)) {
      expect(copy.label).toMatch(/^vdc\.transportMode/)
      expect(copy.hint).toMatch(/Hint$/)
    }
  })

  it('draws one box per node with its address, and the cluster network band', () => {
    renderWithProviders(<TransportModeDiagram mode="cluster" nodes={NODES} externalPeers={[]} />)
    const svg = screen.getByRole('img')
    expect(svg.textContent).toContain('pve1')
    expect(svg.textContent).toContain('203.0.113.12')
    expect(svg.textContent).toContain('VXLAN')
    // The hint doubles as the accessible name and is repeated in the caption.
    expect(screen.getAllByText(svg.getAttribute('aria-label') as string).length).toBeGreaterThanOrEqual(1)
  })

  it('draws an endpoint outside the cluster as an external dashed box, in peers mode', () => {
    renderWithProviders(<TransportModeDiagram mode="peers" nodes={NODES} externalPeers={['198.51.100.254']} />)
    const svg = screen.getByRole('img')
    expect(svg.textContent).toContain('198.51.100.254')
    // Three boxes: two nodes and the external endpoint, the last one dashed.
    const rects = svg.querySelectorAll('rect')
    expect(rects.length).toBe(3)
    expect(rects[2].getAttribute('stroke-dasharray')).toBe('3 2')
    expect(rects[0].getAttribute('stroke-dasharray')).toBeNull()
  })

  it('names the VLAN interface and the segment in transport mode, with a solid accented band', () => {
    renderWithProviders(<TransportModeDiagram mode="transport" nodes={NODES} externalPeers={[]} iface="vmbr0.4000" segment="198.51.100.0/24" />)
    const svg = screen.getByRole('img')
    expect(svg.textContent).toContain('vmbr0.4000')
    expect(svg.textContent).toContain('198.51.100.0/24')
    expect(svg.querySelector('g.accent')).not.toBeNull()
  })

  it('falls back to three placeholder nodes when nothing answered yet', () => {
    renderWithProviders(<TransportModeDiagram mode="cluster" nodes={[]} externalPeers={[]} />)
    const svg = screen.getByRole('img')
    expect(svg.textContent).toContain('node1')
    expect(svg.textContent).toContain('node3')
    expect(svg.querySelectorAll('rect').length).toBe(3)
  })

  it('folds a big cluster into a "+N" box while keeping one external endpoint visible', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `node-with-a-long-name-${i}`, address: `2001:db8::${i}` }))
    renderWithProviders(<TransportModeDiagram mode="peers" nodes={many} externalPeers={['198.51.100.1', '198.51.100.2']} />)
    const svg = screen.getByRole('img')
    // Five boxes at most: three nodes, one external, one overflow.
    expect(svg.querySelectorAll('rect').length).toBe(5)
    // 8 nodes - 3 shown + 1 hidden external = 6 folded.
    expect(svg.textContent).toContain('+6')
    expect(svg.textContent).toContain('198.51.100.1')
    expect(svg.textContent).not.toContain('198.51.100.2')
    // Long names are clipped with an ellipsis.
    expect(svg.textContent).toContain('…')
  })
})
