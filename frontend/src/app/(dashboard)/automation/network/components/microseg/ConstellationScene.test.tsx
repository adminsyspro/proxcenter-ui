/**
 * The constellation scene once it has a size: the frame loop places every pastille and every arc, rides the points on
 * the observed arcs, hides the names that would cover a nearer pastille, and draws again on a drag, the wheel, the
 * pointer and the controls. Every kind of pastille is drawn: zones, guests, "+N", the guests in no zone, addresses,
 * gateways, named networks, Unknown / External and Outside.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { Edge, Node } from '@xyflow/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

import { buildConstellationGraph } from './constellationGraph'
import { mapViewGraph } from './mapViewGraph'
import { demoInput, flow, member, seen } from './mapViewsTestKit'
import ZoneConstellation from './ZoneConstellation'
import type { MapInput } from './zoneGraph'

/** The map box: 1200 x 800 as soon as it is observed. */
class SizedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() { this.callback([{ contentRect: { width: 1200, height: 800 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver) }
  unobserve() {}
  disconnect() {}
}

let reduced = false
beforeEach(() => {
  reduced = false
  vi.stubGlobal('ResizeObserver', SizedResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const handlers = () => ({
  onSelectZone: vi.fn(), onEnterZone: vi.fn(), onSelectGuest: vi.fn(), onSelectEdge: vi.fn(), onHover: vi.fn(), onFocusNode: vi.fn(), onClear: vi.fn(),
})
function draw(graph: { nodes: Node[]; edges: Edge[] }, h = handlers()) {
  renderWithProviders(<ZoneConstellation nodes={graph.nodes} edges={graph.edges} {...h} />)
  return h
}
const star = (id: string) => document.querySelector(`[data-star="${id}"]`) as HTMLElement
const placed = (id: string) => /translate3d\(/.test(star(id)?.style.transform ?? '')
const lines = () => [...document.querySelectorAll('[data-arc] .line')].map(p => p.getAttribute('d') ?? '')
const riders = () => [...document.querySelectorAll('[data-arc] circle')].map(c => c.getAttribute('cx'))
const tick = (ms = 120) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

/** Inside zone web of the demo draft: 70 guests (60 drawn and a "+N"), a pending one, an address, a gateway, a named network. */
function insideInput(): MapInput {
  const input = demoInput()
  const web = Array.from({ length: 70 }, (_, i) => member(100 + i, `web-${i + 1}`, [`10.0.1.${i + 1}`], { pending: i === 0 }))
  input.members.set('zw', web)
  return {
    ...input,
    zones: input.zones.map(z => (z.id === 'zw' ? { ...z, gateway: '10.0.1.254' } : z)),
    flows: [...input.flows, flow('gw', { src_zone_id: '', src_cidr: '10.0.1.254/32', dst_zone_id: 'zw', dport: '22' })],
    suggestions: [
      ...input.suggestions,
      seen('n1', { src_zone_id: '', src_ip: '198.51.100.7', dst_zone_id: 'zw', dst_ip: '10.0.1.2', dport: '443', hits: 90 }),
      seen('n2', { src_zone_id: '', src_ip: '192.0.2.44', dst_zone_id: 'zw', dst_ip: '10.0.1.3', dport: '80', hits: 60 }),
    ],
    networks: [{ name: 'partners', cidr: '198.51.100.0/24' }],
  }
}

describe('the constellation scene with a size', () => {
  it('places every pastille and every arc, and rides the points on the busiest observed arcs', async () => {
    const graph = buildConstellationGraph(demoInput())
    draw(graph)
    await waitFor(() => expect(placed('zone:zw')).toBe(true))
    for (const n of graph.nodes) expect(placed(n.id)).toBe(true)
    // Nearer pastilles over further ones: a depth of their own.
    expect(new Set(graph.nodes.map(n => star(n.id).style.zIndex)).size).toBeGreaterThan(1)
    expect(lines().every(d => d.startsWith('M'))).toBe(true)
    await tick(200)
    expect(riders().some(cx => cx !== null)).toBe(true)
    // A name is drawn under its disc, or hidden when it would cover a nearer pastille.
    const names = graph.nodes.map(n => (star(n.id).lastElementChild as HTMLElement).style.opacity)
    expect(names.every(o => o === '1' || o === '0')).toBe(true)
  })

  it('draws again on a drag, the wheel, the controls and under the pointer, and stops turning under it', async () => {
    const h = draw(buildConstellationGraph(demoInput()))
    await waitFor(() => expect(placed('zone:zd')).toBe(true))
    const scene = screen.getByTestId('zone-constellation')
    const before = star('zone:zd').style.transform
    fireEvent.pointerDown(scene, { button: 0, clientX: 300, clientY: 300, pointerId: 1 })
    fireEvent.pointerMove(scene, { clientX: 302, clientY: 301, pointerId: 1 })
    fireEvent.pointerMove(scene, { clientX: 420, clientY: 360, pointerId: 1 })
    fireEvent.pointerUp(scene, { pointerId: 1 })
    await tick()
    expect(star('zone:zd').style.transform).not.toBe(before)
    // The click that ends a drag opens nothing.
    fireEvent.click(scene)
    expect(h.onClear).not.toHaveBeenCalled()
    fireEvent.click(scene)
    expect(h.onClear).toHaveBeenCalled()

    const zoomed = star('zone:zd').style.transform
    fireEvent.wheel(scene, { deltaY: -400 })
    await tick()
    expect(star('zone:zd').style.transform).not.toBe(zoomed)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fit the map to the view' }))
    await tick()

    fireEvent.pointerEnter(scene)
    await tick()
    // Under the pointer the arcs take the pointer: their wide path follows them.
    expect([...document.querySelectorAll('[data-arc] .hit')].every(p => (p.getAttribute('d') ?? '').startsWith('M'))).toBe(true)
    const still = star('zone:zd').style.transform
    await tick(150)
    expect(star('zone:zd').style.transform).toBe(still)
    fireEvent.pointerLeave(scene)

    const arc = document.querySelector('[data-arc]') as HTMLElement
    fireEvent.pointerEnter(arc)
    expect(h.onHover).toHaveBeenCalledWith(arc.dataset.arc)
    fireEvent.click(arc)
    expect(h.onSelectEdge).toHaveBeenCalledWith(arc.dataset.arc)
    fireEvent.pointerLeave(arc)
    expect(h.onHover).toHaveBeenLastCalledWith(null)
  })

  it('draws the centre, "+N", the pending guests, the addresses, the gateway and the named network of an entered zone', async () => {
    const graph = mapViewGraph('inside', insideInput(), 'zw')
    const h = draw(graph)
    const centre = await screen.findByTestId('constellation-centre')
    expect(centre.textContent).toContain('web')
    expect(centre.textContent).toContain('70 members')
    await waitFor(() => expect(/translate3d/.test(centre.style.transform)).toBe(true))
    const more = document.querySelector('[data-star^="more:"]') as HTMLElement
    // 60 drawn: 59 guests and the "+N" of the 11 others.
    expect(more.textContent).toContain('+11')
    fireEvent.click(more)
    expect(h.onSelectZone).toHaveBeenCalledWith('zw')
    fireEvent.click(star('guest:zw:qemu/101'))
    expect(h.onSelectGuest).toHaveBeenCalledWith('guest:zw:qemu/101')
    const labels = [...document.querySelectorAll('[data-star]')].map(s => s.getAttribute('aria-label'))
    expect(labels).toContain('Gateway')
    expect(labels).toContain('partners')
    expect(labels).toContain('192.0.2.44')
    expect(star('guest:zw:qemu/100').querySelector('.constellation-disc')).toBeTruthy()
    // The centre is the zone: a click and the keyboard open its panel.
    fireEvent.click(centre)
    fireEvent.keyDown(centre, { key: 'Enter' })
    expect(h.onSelectZone).toHaveBeenCalledTimes(3)
  })

  it('lights the arcs a focus keeps, fades the stale ones, and names only the front of a crowded sphere', async () => {
    const graph = buildConstellationGraph(demoInput())
    const edges = graph.edges.map((e, i) => ({ ...e, className: ['microseg-dim', 'microseg-stale', undefined][i % 3] }))
    const nodes = graph.nodes.map((n, i) => (i === 0 ? { ...n, className: 'microseg-faint', selected: true } : n))
    draw({ nodes, edges })
    await waitFor(() => expect(placed(nodes[0].id)).toBe(true))
    expect(document.querySelectorAll('[data-arc][data-lit="true"]').length).toBeGreaterThan(0)
    expect(star(nodes[0].id).dataset.pinned).toBe('true')

    cleanup()
    // jsdom lays nothing out: the names are given the size a browser gives them.
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80)
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(18)
    const crowded = Array.from({ length: 60 }, (_, i) => ({ id: `zone:z${i}`, position: { x: 0, y: 0 }, data: { kind: 'zone', zone: { ...demoInput().zones[0], id: `z${i}`, name: `zone-${i}` }, members: 1, state: 'observe', radius: 0 } })) as unknown as Node[]
    draw({ nodes: crowded, edges: [] })
    await waitFor(() => expect(placed('zone:z0')).toBe(true))
    const hidden = crowded.filter(n => (star(n.id).lastElementChild as HTMLElement).style.opacity === '0')
    expect(hidden.length).toBeGreaterThan(0)
    expect(hidden.length).toBeLessThan(crowded.length)
    width.mockRestore()
    height.mockRestore()
  })

  it('draws once per change with reduced motion: no turn, no riding point, the wheel still zooms', async () => {
    reduced = true
    draw(buildConstellationGraph(demoInput()))
    await waitFor(() => expect(placed('zone:zw')).toBe(true))
    expect(riders()).toEqual([])
    const before = star('zone:zw').style.transform
    await tick(150)
    expect(star('zone:zw').style.transform).toBe(before)
    fireEvent.wheel(screen.getByTestId('zone-constellation'), { deltaY: 300 })
    await tick()
    expect(star('zone:zw').style.transform).not.toBe(before)
  })
})
