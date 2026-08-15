import { describe, it, expect, vi } from 'vitest'
import { deepmerge } from '@mui/utils'
import { createTheme, lighten, darken, getContrastRatio } from '@mui/material/styles'

import defaultCoreTheme from '@core/theme'

import {
  CONTRAST_THRESHOLD,
  INHERIT_ON_PRIMARY_SX,
  ON_PRIMARY_DARK_TEXT,
  ON_PRIMARY_LIGHT_TEXT,
  contrastRatioVsWhite,
  onPrimaryTextColor,
  relativeLuminance
} from './onPrimary'

// `@core/theme` loads a Google font at import time, which needs the Next build
// pipeline. Only the palette matters here.
vi.mock('next/font/google', () => ({
  Inter: () => ({ style: { fontFamily: 'Inter' } })
}))

// Colours a customer can realistically set as branding / theme primary.
const DARK_ENOUGH_FOR_WHITE = [
  '#7C4DFF', // template default purple, 4.82
  '#E57000', // ProxCenter default orange, 3.16
  '#2092EC', // blue preset, 3.29
  '#8B5CF6' // purple preset, 4.23
]

const TOO_LIGHT_FOR_WHITE = [
  '#FFD200', // the white-label yellow from issue #460, 1.45
  '#FFAB1D', // amber preset, 1.89
  '#F59E0B', // yellow preset, 2.15
  '#22C55E', // green preset, 2.28
  '#06B6D4' // cyan preset, 2.43
]

describe('onPrimaryTextColor', () => {
  it.each(DARK_ENOUGH_FOR_WHITE)('keeps white text on %s', color => {
    expect(onPrimaryTextColor(color)).toBe(ON_PRIMARY_LIGHT_TEXT)
  })

  it.each(TOO_LIGHT_FOR_WHITE)('flips to dark text on %s', color => {
    expect(onPrimaryTextColor(color)).toBe(ON_PRIMARY_DARK_TEXT)
  })

  it('accepts the shorthand and rgb() notations', () => {
    expect(onPrimaryTextColor('#fd0')).toBe(ON_PRIMARY_DARK_TEXT)
    expect(onPrimaryTextColor('#FFD200FF')).toBe(ON_PRIMARY_DARK_TEXT)
    expect(onPrimaryTextColor('rgb(255, 210, 0)')).toBe(ON_PRIMARY_DARK_TEXT)
    expect(onPrimaryTextColor('rgba(124, 77, 255, 1)')).toBe(ON_PRIMARY_LIGHT_TEXT)
  })

  it('falls back to white rather than blanking the text on an unusable colour', () => {
    // A branding colour is free-form user input and reaches the report
    // generator unvalidated; returning null there would render `color: null`.
    expect(onPrimaryTextColor('')).toBe(ON_PRIMARY_LIGHT_TEXT)
    expect(onPrimaryTextColor('tomato')).toBe(ON_PRIMARY_LIGHT_TEXT)
    expect(onPrimaryTextColor('#GGGGGG')).toBe(ON_PRIMARY_LIGHT_TEXT)
    expect(onPrimaryTextColor('rgb(300, 0, 0)')).toBe(ON_PRIMARY_LIGHT_TEXT)
  })

  it('switches exactly at the MUI threshold', () => {
    // Adjacent greys either side of ratio 3: #949494 is 3.03, #959595 is 3.00
    // minus a hair. One step of red is all that separates the two verdicts.
    expect(contrastRatioVsWhite('#949494')).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD)
    expect(onPrimaryTextColor('#949494')).toBe(ON_PRIMARY_LIGHT_TEXT)
    expect(contrastRatioVsWhite('#959595')).toBeLessThan(CONTRAST_THRESHOLD)
    expect(onPrimaryTextColor('#959595')).toBe(ON_PRIMARY_DARK_TEXT)
  })
})

describe('contrast maths', () => {
  it('matches MUI getContrastRatio', () => {
    for (const color of [...DARK_ENOUGH_FOR_WHITE, ...TOO_LIGHT_FOR_WHITE, '#000', '#fff']) {
      // MUI rounds the luminance to 3 decimals before dividing, so the two
      // ratios differ in the third decimal at most. The verdict, asserted
      // below against the real theme, is what has to agree exactly.
      expect(contrastRatioVsWhite(color)).toBeCloseTo(getContrastRatio(color, '#fff'), 2)
    }
  })

  it('reports luminance between black and white', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('nope')).toBeNull()
    expect(contrastRatioVsWhite('nope')).toBeNull()
  })
})

describe('theme primary.contrastText', () => {
  // Mirrors components/theme/index.jsx: the branded primary is merged over the
  // core theme with main/light/dark only, leaving contrastText to MUI. This
  // locks that behaviour: hardcoding contrastText in colorSchemes.js would send
  // white text back onto light primaries, which is issue #460.
  const buildTheme = (primary: string) => {
    const branded = {
      colorSchemes: {
        light: {
          palette: {
            primary: { main: primary, light: lighten(primary, 0.2), dark: darken(primary, 0.1) }
          }
        },
        dark: {
          palette: {
            primary: { main: primary, light: lighten(primary, 0.2), dark: darken(primary, 0.1) }
          }
        }
      },
      cssVariables: { colorSchemeSelector: 'data' }
    }

    return createTheme(deepmerge(defaultCoreTheme({ skin: 'default' }, 'light', 'ltr'), branded))
  }

  it.each([...DARK_ENOUGH_FOR_WHITE, ...TOO_LIGHT_FOR_WHITE])(
    'agrees with onPrimaryTextColor for %s in both colour schemes',
    color => {
      const theme = buildTheme(color) as any
      const expected = onPrimaryTextColor(color)

      expect(theme.colorSchemes.light.palette.primary.contrastText).toBe(expected)
      expect(theme.colorSchemes.dark.palette.primary.contrastText).toBe(expected)
    }
  )
})

describe('INHERIT_ON_PRIMARY_SX', () => {
  it('makes Typography and ListItemText follow the surface colour', () => {
    expect(INHERIT_ON_PRIMARY_SX).toEqual({
      '& .MuiTypography-root': { color: 'inherit' },
      '& .MuiListItemText-primary, & .MuiListItemText-secondary': { color: 'inherit' }
    })
  })
})
