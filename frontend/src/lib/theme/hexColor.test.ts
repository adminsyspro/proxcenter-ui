import { describe, expect, it } from 'vitest'
import { lighten, darken } from '@mui/material/styles'

import { isHexColor, normalizeHexColor, resolveHexColor } from './hexColor'

const BRAND_FALLBACK = '#E57000'

describe('normalizeHexColor', () => {
  it('keeps a well-formed six-digit hex colour untouched', () => {
    expect(normalizeHexColor('#00ECB2')).toBe('#00ECB2')
  })

  it("adds the '#' the administrator left out (the #754 report)", () => {
    expect(normalizeHexColor('00ECB2')).toBe('#00ECB2')
  })

  it('accepts the three-digit shorthand, with or without the hash', () => {
    expect(normalizeHexColor('#0eb')).toBe('#0eb')
    expect(normalizeHexColor('0eb')).toBe('#0eb')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeHexColor('  #00ECB2  ')).toBe('#00ECB2')
  })

  it('rejects non-hex characters, which MUI resolves to rgb(NaN, NaN, NaN)', () => {
    expect(normalizeHexColor('#ZZZZZZ')).toBeNull()
    expect(normalizeHexColor('#00-CB2')).toBeNull()
  })

  it('rejects named colours and functional notations', () => {
    expect(normalizeHexColor('red')).toBeNull()
    expect(normalizeHexColor('rgb(0, 236, 178)')).toBeNull()
  })

  it('rejects the alpha hex forms, which produce nonsense shades', () => {
    expect(normalizeHexColor('#00EC')).toBeNull()
    expect(normalizeHexColor('#00ECB2FF')).toBeNull()
  })

  it('rejects lengths that are neither three nor six digits', () => {
    expect(normalizeHexColor('#00ECB')).toBeNull()
    expect(normalizeHexColor('#')).toBeNull()
    expect(normalizeHexColor('')).toBeNull()
  })

  it('rejects non-string values', () => {
    expect(normalizeHexColor(undefined)).toBeNull()
    expect(normalizeHexColor(null)).toBeNull()
    expect(normalizeHexColor(0x00ecb2)).toBeNull()
    expect(normalizeHexColor({ primaryColor: '#00ECB2' })).toBeNull()
  })
})

describe('isHexColor', () => {
  it('mirrors normalizeHexColor', () => {
    expect(isHexColor('00ECB2')).toBe(true)
    expect(isHexColor('#00ECB2')).toBe(true)
    expect(isHexColor('nope')).toBe(false)
    expect(isHexColor('')).toBe(false)
  })
})

describe('resolveHexColor', () => {
  it('returns the repaired colour rather than the fallback', () => {
    expect(resolveHexColor('00ECB2', BRAND_FALLBACK)).toBe('#00ECB2')
  })

  it('falls back when the value cannot be repaired', () => {
    expect(resolveHexColor('red', BRAND_FALLBACK)).toBe(BRAND_FALLBACK)
    expect(resolveHexColor('', BRAND_FALLBACK)).toBe(BRAND_FALLBACK)
    expect(resolveHexColor(null, BRAND_FALLBACK)).toBe(BRAND_FALLBACK)
  })
})

describe('every accepted value survives the MUI palette maths', () => {
  // The regression this guards: lighten()/darken() throw on an unsupported
  // colour, and they run while the theme provider renders every page.
  const candidates = ['#00ECB2', '00ECB2', '#0eb', '0eb', '  #00ECB2  ', 'red', '#ZZZZZZ', '#00EC', '', null]

  it.each(candidates.map(value => [JSON.stringify(value), value] as const))(
    'derives light and dark shades from %s',
    (_label, value) => {
      const resolved = resolveHexColor(value, BRAND_FALLBACK)

      expect(() => lighten(resolved, 0.2)).not.toThrow()
      expect(() => darken(resolved, 0.1)).not.toThrow()
      expect(lighten(resolved, 0.2)).not.toContain('NaN')
      expect(darken(resolved, 0.1)).not.toContain('NaN')
    }
  )
})
