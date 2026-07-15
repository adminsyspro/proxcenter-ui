// src/i18n/config.ts
export const locales = ['fr', 'en', 'de', 'zh-CN', 'ko', 'es'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'en'

// Labels for each locale
export const localeNames: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  de: 'Deutsch',
  'zh-CN': '简体中文',
  ko: '한국어',
  es: 'Español',
}

// Flag emojis for each locale. Kept for any consumer that wants raw text;
// most UI should prefer `<CountryFlag code={localeCountryCodes[loc]} />`
// because Chrome/Edge on Windows can't render flag emojis natively.
export const localeFlags: Record<Locale, string> = {
  fr: '🇫🇷',
  en: '🇬🇧',
  de: '🇩🇪',
  'zh-CN': '🇨🇳',
  ko: '🇰🇷',
  es: '🇪🇸',
}

// ISO-3166-1 alpha-2 country codes per locale, used by the <CountryFlag>
// image component (cross-OS / cross-browser flag rendering).
export const localeCountryCodes: Record<Locale, string> = {
  fr: 'FR',
  en: 'GB',
  de: 'DE',
  'zh-CN': 'CN',
  ko: 'KR',
  es: 'ES',
}
