/**
 * The map panels widen from their left edge: dragged or moved with the arrow keys, between their own width and
 * PANEL_MAX_WIDTH, the width kept in this browser for every panel; a double click gives the panel its own width back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import { PANEL_MAX_WIDTH, PanelFrame, clampPanelWidth } from './PanelSection'

const KEY = 'microseg.map.panelWidth'
const render = () => renderWithProviders(<PanelFrame label='Zone web' width={400} header={<span>web</span>}><p>body</p></PanelFrame>)
const edge = () => screen.getByRole('separator', { name: /widen the panel/ })
const width = () => Number(edge().getAttribute('aria-valuenow'))

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('PanelFrame width', () => {
  it('keeps a width between the panel own one and the maximum', () => {
    expect(clampPanelWidth(120, 400)).toBe(400)
    expect(clampPanelWidth(612.4, 400)).toBe(612)
    expect(clampPanelWidth(5000, 400)).toBe(PANEL_MAX_WIDTH)
  })

  it('widens on a drag of the left edge to the left, and keeps the width once dropped', () => {
    render()
    expect(width()).toBe(400)
    fireEvent.pointerDown(edge(), { clientX: 1000 })
    fireEvent.pointerMove(window, { clientX: 760 })
    expect(width()).toBe(640)
    // Dragged past the panel own width to the right: it stays at its own width.
    fireEvent.pointerMove(window, { clientX: 1300 })
    expect(width()).toBe(400)
    fireEvent.pointerMove(window, { clientX: 700 })
    fireEvent.pointerUp(window)
    expect(window.localStorage.getItem(KEY)).toBe('700')
    // Once dropped, a move changes nothing.
    fireEvent.pointerMove(window, { clientX: 100 })
    expect(width()).toBe(700)
  })

  it('moves with the arrow keys, starts from the kept width, and goes back to its own on a double click', () => {
    window.localStorage.setItem(KEY, '600')
    render()
    expect(width()).toBe(600)
    fireEvent.keyDown(edge(), { key: 'ArrowLeft' })
    expect(width()).toBe(632)
    fireEvent.keyDown(edge(), { key: 'ArrowRight' })
    fireEvent.keyDown(edge(), { key: 'ArrowRight' })
    expect(width()).toBe(568)
    fireEvent.keyDown(edge(), { key: 'Enter' })
    expect(width()).toBe(568)
    expect(window.localStorage.getItem(KEY)).toBe('568')
    fireEvent.doubleClick(edge())
    expect(width()).toBe(400)
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it('ignores a kept width that is not a number', () => {
    window.localStorage.setItem(KEY, 'wide')
    render()
    expect(width()).toBe(400)
  })
})
