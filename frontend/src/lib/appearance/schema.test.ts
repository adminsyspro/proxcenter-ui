import { describe, expect, it } from 'vitest'

import globalThemesConfig, { densityConfig } from '@configs/globalThemesConfig'
import lightBackgroundConfig from '@configs/lightBackgroundConfig'

import { APPEARANCE_VALIDATORS, PERSISTED_APPEARANCE_KEYS, sanitizeAppearance } from './schema'

describe('sanitizeAppearance', () => {
  it('keeps known valid keys and drops unknown keys', () => {
    expect(sanitizeAppearance({ evil: 1, primaryColor: '#FFD200' })).toEqual({
      primaryColor: '#FFD200',
    })
  })

  it.each([null, undefined, 'x', 42, []])('returns an empty object for non-object input %#', input => {
    expect(sanitizeAppearance(input)).toEqual({})
  })

  it.each(['#E57000', '#ffd200'])('accepts the six-digit colour %s', primaryColor => {
    expect(sanitizeAppearance({ primaryColor })).toEqual({ primaryColor })
  })

  it.each(['red', '#FFF', '#GGGGGG', '#E57000; background:url(x)', 123, null])(
    'rejects the invalid colour %j',
    primaryColor => {
      expect(sanitizeAppearance({ primaryColor })).toEqual({})
    },
  )

  it.each(['light', 'dark', 'system'])('accepts the mode %s', mode => {
    expect(sanitizeAppearance({ mode })).toEqual({ mode })
  })

  it('rejects an unknown mode', () => {
    expect(sanitizeAppearance({ mode: 'sepia' })).toEqual({})
  })

  it.each(['vertical', 'collapsed', 'horizontal', 'hidden'])('accepts the layout %s', layout => {
    expect(sanitizeAppearance({ layout })).toEqual({ layout })
  })

  it.each(Object.keys(densityConfig))('accepts the configured density %s', density => {
    expect(sanitizeAppearance({ density })).toEqual({ density })
  })

  it('derives valid global theme ids from the shipped config', () => {
    const globalTheme = globalThemesConfig[0].id

    expect(sanitizeAppearance({ globalTheme })).toEqual({ globalTheme })
    expect(sanitizeAppearance({ globalTheme: 'nope' })).toEqual({})
  })

  it('derives valid light background ids from the shipped config', () => {
    const lightBackground = lightBackgroundConfig[0].id

    expect(sanitizeAppearance({ lightBackground })).toEqual({ lightBackground })
    expect(sanitizeAppearance({ lightBackground: 'nope' })).toEqual({})
  })

  it.each([
    ['fontSize', 12, 18, 11, 19, 14.4, 14],
    ['uiScale', 80, 120, 79, 121, 100.4, 100],
    ['blurIntensity', 0, 24, -1, 25, 14.6, 15],
  ] as const)(
    'validates and rounds %s within its numeric range',
    (key, minimum, maximum, below, above, decimal, rounded) => {
      expect(sanitizeAppearance({ [key]: minimum })).toEqual({ [key]: minimum })
      expect(sanitizeAppearance({ [key]: maximum })).toEqual({ [key]: maximum })
      expect(sanitizeAppearance({ [key]: below })).toEqual({})
      expect(sanitizeAppearance({ [key]: above })).toEqual({})
      expect(sanitizeAppearance({ [key]: String(rounded) })).toEqual({})
      expect(sanitizeAppearance({ [key]: Number.NaN })).toEqual({})
      expect(sanitizeAppearance({ [key]: Number.POSITIVE_INFINITY })).toEqual({})
      expect(sanitizeAppearance({ [key]: decimal })).toEqual({ [key]: rounded })
    },
  )

  it('preserves null customBorderRadius as an explicit inherited value', () => {
    const result = sanitizeAppearance({ customBorderRadius: null })

    expect(Object.hasOwn(result, 'customBorderRadius')).toBe(true)
    expect(result.customBorderRadius).toBeNull()
  })

  it.each([undefined, -1, 25])('drops an invalid customBorderRadius value %j', customBorderRadius => {
    const result = sanitizeAppearance({ customBorderRadius })

    expect(Object.hasOwn(result, 'customBorderRadius')).toBe(false)
  })

  it.each([0, 5, 10, 30, 60, 300])('accepts refreshInterval %d', refreshInterval => {
    expect(sanitizeAppearance({ refreshInterval })).toEqual({ refreshInterval })
  })

  it.each([7, 3600])('rejects refreshInterval %d', refreshInterval => {
    expect(sanitizeAppearance({ refreshInterval })).toEqual({})
  })

  it.each([true, false])('accepts boolean semiDark value %s', semiDark => {
    expect(sanitizeAppearance({ semiDark })).toEqual({ semiDark })
  })

  it.each(['true', 1])('rejects non-boolean semiDark value %j', semiDark => {
    expect(sanitizeAppearance({ semiDark })).toEqual({})
  })

  it('drops a present invalid key instead of replacing it with a default', () => {
    const result = sanitizeAppearance({ mode: 'sepia', fontSize: 99, primaryColor: 'red' })

    expect(result).toEqual({})
    expect(Object.hasOwn(result, 'mode')).toBe(false)
  })
})

describe('PERSISTED_APPEARANCE_KEYS', () => {
  it('lists exactly the validator-backed keys', () => {
    expect(PERSISTED_APPEARANCE_KEYS).toEqual(Object.keys(APPEARANCE_VALIDATORS))
  })

  it('excludes the cookie-only login background', () => {
    expect(PERSISTED_APPEARANCE_KEYS).not.toContain('loginBackground')
  })
})
