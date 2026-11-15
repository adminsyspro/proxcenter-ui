/**
 * The matrix on its own: lighting a row and a column under the pointer renders no cell again (the grid's CSS does
 * it), and the Tab stop of the grid stays on a cell that exists when the grid shrinks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, userEvent } from '@/__tests__/setup/renderWithProviders'

import { demoInput, zone } from './mapViewsTestKit'
import { buildMatrix } from './matrixModel'
import { ALL_FLOWS, EXTERNAL_ID, OUTSIDE_ID } from './zoneGraph'
import ZoneMatrix, { ROW_MIN_H, matrixTracks } from './ZoneMatrix'

const renders = vi.hoisted(() => ({ count: 0 }))

afterEach(() => cleanup())

vi.mock('./MatrixCell', async importOriginal => {
  const original = await importOriginal<typeof import('./MatrixCell')>()
  const { createElement, memo } = await import('react')
  const Counted = (props: Parameters<typeof original.MatrixCellView>[0]) => {
    renders.count++
    return createElement(original.MatrixCellView, props)
  }
  return { ...original, default: memo(Counted) }
})

const names = { end: (e: { kind: string; zone: { name: string } | null }) => e.zone?.name ?? (e.kind === 'outside' ? 'Outside' : 'Unknown / External') }

function show(model = buildMatrix(demoInput())) {
  return renderWithProviders(
    <ZoneMatrix model={model} filters={ALL_FLOWS} unapplied={null} selectedCell={null} selectedZone={null} onSelectCell={() => undefined} onSelectZone={() => undefined} names={names} />,
  )
}

describe('ZoneMatrix', () => {
  it('writes a known service as its name in the chip of a cell, with the protocol and the port in its tooltip', async () => {
    const web = zone('zw', 'web')
    const db = zone('zd', 'db')
    const flow = (id: string, dport: string) => ({ ...demoInput().flows[0], id, src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zd', dst_cidr: '', proto: 'tcp', dport })
    show(buildMatrix({ zones: [web, db], flows: [flow('f1', '5432'), flow('f2', '42001')], suggestions: [] }))
    expect(screen.getByText('PostgreSQL')).toBeTruthy()
    expect(screen.getByText('tcp/42001')).toBeTruthy()
    await userEvent.hover(screen.getByText('PostgreSQL'))
    expect((await screen.findByRole('tooltip')).textContent).toBe('PostgreSQL (tcp/5432)')
  })

  it('fills the map: the frame takes all of it, the zone columns and rows share the room left (1fr)', () => {
    show()
    const frame = screen.getByTestId('matrix-frame')
    const grid = screen.getByRole('grid')
    expect(getComputedStyle(frame).height).toBe('100%')
    expect(getComputedStyle(frame).overflow).toBe('auto')
    expect(getComputedStyle(grid).height).toBe('100%')
    expect(getComputedStyle(grid).width).toBe('100%')
    expect(grid.getAttribute('data-columns')).toBe('190px repeat(7, minmax(150px, 1fr))')
    expect(grid.getAttribute('data-rows')).toBe(`auto repeat(7, minmax(${ROW_MIN_H}px, 1fr))`)
    expect(getComputedStyle(grid).gridTemplateColumns).toBe('190px repeat(7, minmax(150px, 1fr))')
    expect(getComputedStyle(grid).gridTemplateRows).toBe(`auto repeat(7, minmax(${ROW_MIN_H}px, 1fr))`)
  })

  it('scrolls only when the least sizes do not fit: 40 zones need more than a 1600x900 map', () => {
    const zones = Array.from({ length: 40 }, (_, i) => zone(`z${i}`, `zone-${String(i).padStart(2, '0')}`))
    show(buildMatrix({ zones, flows: [], suggestions: [] }))
    const tracks = matrixTracks(41, 41, false)
    expect(tracks.minWidth).toBeGreaterThan(1600)
    expect(tracks.minHeight).toBeGreaterThan(900)
    expect(getComputedStyle(screen.getByRole('grid')).minWidth).toBe(`${tracks.minWidth}px`)
    expect(getComputedStyle(screen.getByRole('grid')).minHeight).toBe(`${tracks.minHeight}px`)
    expect(matrixTracks(7, 7, false).minWidth).toBeLessThan(1600)
    expect(matrixTracks(7, 7, true).columns).toBe('150px repeat(7, minmax(112px, 1fr))')
  })

  it('lights the row and the column under the pointer without rendering any cell again', () => {
    show()
    const grid = screen.getByRole('grid')
    const cells = screen.getAllByRole('gridcell')
    expect(cells).toHaveLength(7 * 7)
    const before = renders.count
    fireEvent.mouseEnter(cells[8])
    fireEvent.mouseEnter(cells[20])
    expect(renders.count).toBe(before)
    expect(grid.getAttribute('data-lit-row')).toBe(cells[20].getAttribute('data-row'))
    expect(grid.getAttribute('data-lit-col')).toBe(cells[20].getAttribute('data-col'))
    fireEvent.mouseLeave(grid.parentElement!)
    expect(grid.getAttribute('data-lit-row')).toBe('')
    expect(renders.count).toBe(before)
  })

  it('moves the Tab stop with the keyboard, rendering only the two cells concerned', () => {
    show()
    const first = screen.getAllByRole('gridcell')[0]
    first.focus()
    const before = renders.count
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(document.activeElement?.getAttribute('data-cell')).toBe('0:1')
    expect(renders.count - before).toBe(2)
  })

  it('keeps a Tab stop on a cell that exists when the grid shrinks', () => {
    const view = show()
    const cells = screen.getAllByRole('gridcell')
    const last = cells[cells.length - 1]
    fireEvent.click(last)
    expect(last.getAttribute('tabindex')).toBe('0')
    const input = demoInput()
    view.rerender(
      <ZoneMatrix
        model={buildMatrix({ ...input, zones: input.zones.slice(0, 2) })}
        filters={ALL_FLOWS}
        unapplied={null}
        selectedCell={null}
        selectedZone={null}
        onSelectCell={() => undefined}
        onSelectZone={() => undefined}
        names={names}
      />,
    )
    const smaller = screen.getAllByRole('gridcell')
    expect(smaller).toHaveLength(3 * 3)
    expect(smaller.filter(c => c.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(smaller.find(c => c.getAttribute('tabindex') === '0')!.getAttribute('data-row')).toBe(EXTERNAL_ID)
    expect(smaller.find(c => c.getAttribute('tabindex') === '0')!.getAttribute('data-col')).toBe(OUTSIDE_ID)
  })
})
