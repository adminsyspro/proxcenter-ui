import { describe, expect, it } from 'vitest'

import { paletteColor } from './paletteColor'

describe('paletteColor', () => {
  it('maps a theme path to its MUI CSS variable', () => {
    expect(paletteColor('success.main')).toBe('var(--mui-palette-success-main)')
    expect(paletteColor('text.secondary')).toBe('var(--mui-palette-text-secondary)')
    expect(paletteColor('divider')).toBe('var(--mui-palette-divider)')
  })

  it('leaves a literal colour alone and drops nothing', () => {
    expect(paletteColor('#ff9800')).toBe('#ff9800')
    expect(paletteColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)')
    expect(paletteColor('inherit')).toBe('inherit')
    expect(paletteColor(undefined)).toBeUndefined()
    expect(paletteColor('')).toBeUndefined()
    expect(paletteColor(42)).toBeUndefined()
  })
})
