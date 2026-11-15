/**
 * The Sankey rendering fills the map box (UA45): it measures the box under its hint line, lays the diagram out at that
 * size (bars at about 22 % and 78 % of the width), lays it out again once a resize settles, and falls back to the
 * compact drawing scaled to the width under 720 px or before it is measured.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import { demoInput } from './mapViewsTestKit'
import { buildMatrix } from './matrixModel'
import { BOX_SIZE_DELAY } from './useBoxSize'
import { ALL_FLOWS } from './zoneGraph'
import ZoneSankey from './ZoneSankey'

/** A stand-in for ResizeObserver: the test says when the observed box has a new size. */
const observers: Array<{ callback: ResizeObserverCallback; target: Element | null }> = []
class FakeResizeObserver {
  private readonly entry: { callback: ResizeObserverCallback; target: Element | null }
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, target: null }
    observers.push(this.entry)
  }
  observe(target: Element) { this.entry.target = target }
  unobserve() { this.entry.target = null }
  disconnect() { this.entry.target = null }
}
function resize(width: number, height: number) {
  act(() => {
    for (const o of observers) {
      if (o.target) o.callback([{ contentRect: { width, height } } as unknown as ResizeObserverEntry], o as unknown as ResizeObserver)
    }
  })
}

beforeEach(() => {
  observers.length = 0
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const names = { end: (e: { zone: { name: string } | null; kind: string }) => e.zone?.name ?? e.kind }
function draw() {
  renderWithProviders(
    <ZoneSankey model={buildMatrix(demoInput())} filters={ALL_FLOWS} selectedCell={null} selectedZone={null} onSelectCell={() => undefined} onSelectZone={() => undefined} names={names} />,
  )
  return () => screen.getByRole('figure').querySelector('svg')!
}
const sourceBarX = (svg: SVGSVGElement) => svg.querySelector('[data-node^="source:"] rect')!.getAttribute('x')
const targetBarX = (svg: SVGSVGElement) => svg.querySelector('[data-node^="target:"] rect')!.getAttribute('x')

describe('the Sankey diagram fills the map box', () => {
  it('draws the compact diagram before the box is measured', () => {
    const svg = draw()
    expect(svg().getAttribute('data-fill')).toBe('false')
    expect(svg().getAttribute('width')).toBe('100%')
    expect(svg().getAttribute('viewBox')).toMatch(/^0 0 960 /)
    expect(sourceBarX(svg())).toBe('210')
  })

  it('takes the size of the box at once, and lays out again once a resize has settled', () => {
    const svg = draw()
    resize(1200, 700)
    expect(svg().getAttribute('data-fill')).toBe('true')
    expect(svg().getAttribute('viewBox')).toBe('0 0 1200 700')
    expect(svg().getAttribute('width')).toBe('1200')
    expect(svg().getAttribute('height')).toBe('700')
    expect(sourceBarX(svg())).toBe('252')
    expect(targetBarX(svg())).toBe('936')
    // The headings sit over their columns.
    expect(screen.getByText('Sources').getAttribute('x')).toBe(String(252 + 6))
    expect(screen.getByText('Destinations').getAttribute('x')).toBe(String(936 + 6))

    resize(1600, 900)
    expect(svg().getAttribute('viewBox')).toBe('0 0 1200 700')
    act(() => { vi.advanceTimersByTime(BOX_SIZE_DELAY) })
    expect(svg().getAttribute('viewBox')).toBe('0 0 1600 900')
    expect(sourceBarX(svg())).toBe('340')
    expect(targetBarX(svg())).toBe('1248')
  })

  it('only takes the last size of a burst of resizes', () => {
    const svg = draw()
    resize(1200, 700)
    resize(1300, 700)
    act(() => { vi.advanceTimersByTime(BOX_SIZE_DELAY / 2) })
    resize(1500, 800)
    act(() => { vi.advanceTimersByTime(BOX_SIZE_DELAY / 2) })
    expect(svg().getAttribute('viewBox')).toBe('0 0 1200 700')
    act(() => { vi.advanceTimersByTime(BOX_SIZE_DELAY) })
    expect(svg().getAttribute('viewBox')).toBe('0 0 1500 800')
  })

  it('falls back to the compact diagram in a box narrower than 720 px', () => {
    const svg = draw()
    resize(1200, 700)
    resize(640, 700)
    act(() => { vi.advanceTimersByTime(BOX_SIZE_DELAY) })
    expect(svg().getAttribute('data-fill')).toBe('false')
    expect(svg().getAttribute('width')).toBe('100%')
    expect(sourceBarX(svg())).toBe('210')
  })

  it('starts filling at 735 px and keeps filling down to 720 px (no flip around the threshold)', () => {
    const svg = draw()
    resize(728, 700)
    expect(svg().getAttribute('data-fill')).toBe('false')
    resize(735, 700)
    act(() => { vi.advanceTimersByTime(BOX_SIZE_DELAY) })
    expect(svg().getAttribute('data-fill')).toBe('true')
    resize(725, 700)
    act(() => { vi.advanceTimersByTime(BOX_SIZE_DELAY) })
    expect(svg().getAttribute('data-fill')).toBe('true')
    resize(719, 700)
    act(() => { vi.advanceTimersByTime(BOX_SIZE_DELAY) })
    expect(svg().getAttribute('data-fill')).toBe('false')
    resize(728, 700)
    act(() => { vi.advanceTimersByTime(BOX_SIZE_DELAY) })
    expect(svg().getAttribute('data-fill')).toBe('false')
  })

  it('rounds a fractional box size down (a fractional zoom must not make a phantom scrollbar)', () => {
    const svg = draw()
    resize(1200.9, 700.7)
    expect(svg().getAttribute('viewBox')).toBe('0 0 1200 700')
  })

  it('keeps the compact diagram where the browser has no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const svg = draw()
    expect(svg().getAttribute('data-fill')).toBe('false')
  })
})
