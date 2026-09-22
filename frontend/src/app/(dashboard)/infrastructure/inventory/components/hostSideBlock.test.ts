import { describe, expect, it } from 'vitest'

import { hostSideBlockSx, hostSideHandleSx } from './hostSideBlock'

// The host summary lays its blocks in a row from `xl` up and stacks them in a
// column below it. The collapsed updates/subscription tiles used to be sized
// for the row only, so on a narrower screen they became a 44px-wide ribbon
// stranded under the card.
describe('collapsed host side block (updates / subscription tiles)', () => {
  it('is a full-width bar once the card stacks, and a narrow rail in a row', () => {
    const sx = hostSideBlockSx(true)

    expect(sx.width).toEqual({ xs: '100%', xl: 44 })
    expect(sx.minWidth).toEqual({ xs: 'auto', xl: 44 })
    expect(sx.flex).toBe('0 0 auto')
  })

  it('takes its share of the row when expanded, at any width', () => {
    const sx = hostSideBlockSx(false)

    expect(sx.flex).toBe(1)
    expect(sx.width).toBe('auto')
    expect(sx.minWidth).toBeUndefined()
  })

  it('lays the collapsed handle across when stacked and down when in a row', () => {
    const sx = hostSideHandleSx()

    expect(sx.flexDirection).toEqual({ xs: 'row', xl: 'column' })
  })

  it('keeps the stacked handle to a bar height instead of the rail height', () => {
    const sx = hostSideHandleSx()

    expect(sx.minHeight).toEqual({ xs: 44, xl: 150 })
  })
})
