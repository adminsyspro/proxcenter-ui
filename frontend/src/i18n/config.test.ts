import { describe, it, expect } from 'vitest'
import { locales, localeNames, localeFlags, localeCountryCodes, defaultLocale } from './config'

describe('i18n config', () => {
  it('includes Korean and Spanish locales', () => {
    expect(locales).toContain('ko')
    expect(locales).toContain('es')
  })

  it('has names for all locales', () => {
    for (const loc of locales) {
      expect(localeNames[loc]).toBeTruthy()
    }
    expect(localeNames.ko).toBe('한국어')
    expect(localeNames.es).toBe('Español')
  })

  it('has flags for all locales', () => {
    for (const loc of locales) {
      expect(localeFlags[loc]).toBeTruthy()
    }
  })

  it('has country codes for all locales', () => {
    for (const loc of locales) {
      expect(localeCountryCodes[loc]).toBeTruthy()
    }
    expect(localeCountryCodes.ko).toBe('KR')
    expect(localeCountryCodes.es).toBe('ES')
  })

  it('default locale is en', () => {
    expect(defaultLocale).toBe('en')
  })
})
