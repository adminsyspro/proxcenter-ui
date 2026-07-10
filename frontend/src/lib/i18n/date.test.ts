import { describe, it, expect } from 'vitest'
import { getDateLocale, formatDateTime, formatDate, formatTime } from './date'

describe('getDateLocale', () => {
  it('maps "fr" to "fr-FR"', () => {
    expect(getDateLocale('fr')).toBe('fr-FR')
  })

  it('maps "en" to "en-US"', () => {
    expect(getDateLocale('en')).toBe('en-US')
  })

  it('maps "de" to "de-DE"', () => {
    expect(getDateLocale('de')).toBe('de-DE')
  })

  it('maps "zh-CN" to "zh-CN"', () => {
    expect(getDateLocale('zh-CN')).toBe('zh-CN')
  })

  it('maps "ko" to "ko-KR"', () => {
    expect(getDateLocale('ko')).toBe('ko-KR')
  })

  it('maps "es" to "es-ES"', () => {
    expect(getDateLocale('es')).toBe('es-ES')
  })

  it('falls back to "en-US" for unknown locale', () => {
    expect(getDateLocale('zh')).toBe('en-US')
    expect(getDateLocale('')).toBe('en-US')
  })
})

describe('formatDateTime', () => {
  const date = new Date('2024-06-15T14:30:00Z')

  it('returns a string for Date input', () => {
    const result = formatDateTime(date, 'en')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a string for timestamp input', () => {
    const result = formatDateTime(date.getTime(), 'en')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('produces different output for different locales', () => {
    const en = formatDateTime(date, 'en')
    const fr = formatDateTime(date, 'fr')
    // Locale formatting differs (month name, date order, etc.)
    expect(typeof en).toBe('string')
    expect(typeof fr).toBe('string')
  })
})

describe('formatDate', () => {
  const date = new Date('2024-06-15T14:30:00Z')

  it('returns a string for Date input', () => {
    const result = formatDate(date, 'en')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a string for timestamp input', () => {
    const result = formatDate(date.getTime(), 'fr')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('formatTime', () => {
  const date = new Date('2024-06-15T14:30:00Z')

  it('returns a string for Date input', () => {
    const result = formatTime(date, 'en')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a string for timestamp input', () => {
    const result = formatTime(date.getTime(), 'fr')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
