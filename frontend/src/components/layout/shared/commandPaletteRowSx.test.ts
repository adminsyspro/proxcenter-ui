import { describe, it, expect } from 'vitest'

import { commandPaletteRowSx } from './commandPaletteRowSx'
import { INHERIT_ON_PRIMARY_SX } from '@/lib/theme/onPrimary'

describe('commandPaletteRowSx', () => {
  it('paints the highlighted row with the primary colour and its contrast text', () => {
    const sx = commandPaletteRowSx(true)

    expect(sx.bgcolor).toBe('primary.main')
    expect(sx.color).toBe('primary.contrastText')
    expect(sx['&:hover']).toEqual({ bgcolor: 'primary.main' })
  })

  it('lets the labels of the highlighted row follow that contrast text', () => {
    // Typography carries an explicit per-variant colour from the theme, so
    // without this the row label stayed text.secondary on a primary
    // background: issue #460, unreadable as soon as the primary is light.
    const sx = commandPaletteRowSx(true)

    for (const [selector, rule] of Object.entries(INHERIT_ON_PRIMARY_SX)) {
      expect(sx[selector as keyof typeof sx]).toEqual(rule)
    }
  })

  it('leaves an idle row on the normal text colours', () => {
    const sx = commandPaletteRowSx(false)

    expect(sx.bgcolor).toBe('transparent')
    expect(sx.color).toBe('text.primary')
    expect(sx['&:hover']).toEqual({ bgcolor: 'action.hover' })

    // No inherit override: idle rows keep the label/caption hierarchy the
    // theme gives them.
    for (const selector of Object.keys(INHERIT_ON_PRIMARY_SX)) {
      expect(sx).not.toHaveProperty(selector)
    }
  })

  it('keeps the layout identical whichever row is highlighted', () => {
    const active = commandPaletteRowSx(true)
    const idle = commandPaletteRowSx(false)

    for (const key of ['display', 'alignItems', 'gap', 'px', 'py', 'borderRadius', 'mx', 'cursor'] as const) {
      expect(active[key]).toBe(idle[key])
    }
  })
})
