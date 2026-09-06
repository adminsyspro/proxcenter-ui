import { describe, it, expect } from 'vitest'

import { commandPaletteRowSx } from './commandPaletteRowSx'

describe('commandPaletteRowSx', () => {
  it('highlights the active row with the neutral selection tint, not the primary colour', () => {
    const sx = commandPaletteRowSx(true)

    expect(sx.bgcolor).toBe('action.selected')
    expect(sx.color).toBe('text.primary')
    expect(sx['&:hover']).toEqual({ bgcolor: 'action.selected' })
  })

  it('leaves an idle row transparent on the normal text colours', () => {
    const sx = commandPaletteRowSx(false)

    expect(sx.bgcolor).toBe('transparent')
    expect(sx.color).toBe('text.primary')
    expect(sx['&:hover']).toEqual({ bgcolor: 'action.hover' })
  })

  it('keeps the layout identical whichever row is highlighted', () => {
    const active = commandPaletteRowSx(true)
    const idle = commandPaletteRowSx(false)

    for (const key of ['display', 'alignItems', 'gap', 'py', 'px', 'borderRadius', 'mx', 'cursor', 'color'] as const) {
      expect(active[key]).toBe(idle[key])
    }
  })
})
