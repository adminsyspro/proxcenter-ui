import { describe, it, expect } from 'vitest'

import {
  normalizeLocale,
  localeToLanguageName,
  languageInstruction,
  jsonLanguageInstruction,
} from './locale'

describe('normalizeLocale', () => {
  it('keeps every supported locale as-is', () => {
    for (const loc of ['fr', 'en', 'de', 'zh-CN', 'ko', 'es']) {
      expect(normalizeLocale(loc)).toBe(loc)
    }
  })

  it('falls back to "en" for unsupported, empty or missing values', () => {
    // `it` (the Italian customer of #686) has no catalogue: English, not a crash.
    expect(normalizeLocale('it')).toBe('en')
    expect(normalizeLocale('zh')).toBe('en')
    expect(normalizeLocale('')).toBe('en')
    expect(normalizeLocale(undefined)).toBe('en')
    expect(normalizeLocale(null)).toBe('en')
  })
})

describe('localeToLanguageName', () => {
  it('maps all six supported locales to an English language name', () => {
    expect(localeToLanguageName('fr')).toBe('French')
    expect(localeToLanguageName('en')).toBe('English')
    expect(localeToLanguageName('de')).toBe('German')
    expect(localeToLanguageName('zh-CN')).toBe('Simplified Chinese')
    expect(localeToLanguageName('ko')).toBe('Korean')
    expect(localeToLanguageName('es')).toBe('Spanish')
  })

  it('falls back to English for an unknown locale', () => {
    expect(localeToLanguageName('it')).toBe('English')
    expect(localeToLanguageName(undefined)).toBe('English')
  })
})

describe('languageInstruction', () => {
  it('names the target language', () => {
    expect(languageInstruction('de')).toContain('German')
    expect(languageInstruction('ko')).toContain('Korean')
  })

  it('states that it overrides the language of the surrounding prompt', () => {
    // The chat prompts are authored in fr/en; without this clause a German
    // user reading an English prompt gets an English answer (#686).
    expect(languageInstruction('es')).toMatch(/overrides any other language/i)
  })

  it('is itself written in English for every locale', () => {
    for (const loc of ['fr', 'en', 'de', 'zh-CN', 'ko', 'es', 'it']) {
      expect(languageInstruction(loc)).toMatch(/^LANGUAGE: your entire answer MUST be written in /)
    }
  })

  it('falls back to English for an unknown locale', () => {
    expect(languageInstruction('it')).toContain('English')
  })
})

describe('jsonLanguageInstruction', () => {
  it('translates values only and keeps the keys in English', () => {
    const instruction = jsonLanguageInstruction('fr')

    expect(instruction).toMatch(/keep every JSON key/i)
    expect(instruction).toMatch(/in English/)
    expect(instruction).toMatch(/value in French/)
  })

  it('falls back to English for an unknown locale', () => {
    expect(jsonLanguageInstruction('it')).toMatch(/value in English/)
  })
})
