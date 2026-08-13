import { describe, it, expect, vi, beforeEach } from 'vitest'

let cookieLocale: string | undefined
let acceptLanguage: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'NEXT_LOCALE' && cookieLocale !== undefined ? { value: cookieLocale } : undefined,
  }),
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === 'accept-language' && acceptLanguage !== undefined ? acceptLanguage : null,
  }),
}))

import {
  normalizeLocale,
  localeToLanguageName,
  languageInstruction,
  jsonLanguageInstruction,
  getRequestLocale,
} from './locale'

beforeEach(() => {
  cookieLocale = undefined
  acceptLanguage = undefined
})

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

// Resolution order mirrors src/i18n/request.ts, which decides the language
// of the UI the answer is displayed in. The two must not disagree: a German
// UI served from Accept-Language with an English AI answer is exactly the
// symptom #686 is about.
describe('getRequestLocale', () => {
  it('prefers the NEXT_LOCALE cookie', async () => {
    cookieLocale = 'ko'
    acceptLanguage = 'de-DE,de;q=0.9'

    await expect(getRequestLocale()).resolves.toBe('ko')
  })

  it('falls back to Accept-Language when the cookie is missing', async () => {
    acceptLanguage = 'de-DE,de;q=0.9,en;q=0.8'

    await expect(getRequestLocale()).resolves.toBe('de')
  })

  it('falls back to Accept-Language when the cookie holds an unsupported locale', async () => {
    cookieLocale = 'it'
    acceptLanguage = 'es-ES,es;q=0.9'

    await expect(getRequestLocale()).resolves.toBe('es')
  })

  it('matches a regional tag exactly before trying its prefix', async () => {
    acceptLanguage = 'zh-CN,zh;q=0.9'

    await expect(getRequestLocale()).resolves.toBe('zh-CN')
  })

  it('skips languages ProxCenter does not ship', async () => {
    acceptLanguage = 'it-IT,it;q=0.9,fr;q=0.7'

    await expect(getRequestLocale()).resolves.toBe('fr')
  })

  it('falls back to English when nothing matches', async () => {
    acceptLanguage = 'it-IT,it;q=0.9'

    await expect(getRequestLocale()).resolves.toBe('en')
  })

  it('falls back to English with neither cookie nor header', async () => {
    await expect(getRequestLocale()).resolves.toBe('en')
  })
})
