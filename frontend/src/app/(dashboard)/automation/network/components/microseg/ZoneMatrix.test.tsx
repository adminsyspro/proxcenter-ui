/**
 * The matrix on its own: lighting a row and a column under the pointer renders no cell again (the grid's CSS does
 * it), and the Tab stop of the grid stays on a cell that exists when the grid shrinks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import { demoInput } from './mapViewsTestKit'
import { buildMatrix } from './matrixModel'
import { ALL_FLOWS, EXTERNAL_ID, OUTSIDE_ID } from './zoneGraph'
import ZoneMatrix from './ZoneMatrix'

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
