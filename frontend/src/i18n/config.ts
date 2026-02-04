// src/i18n/config.ts
export const locales = ['fr', 'en'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'fr'

// Labels for each locale
export const localeNames: Record<Locale, string> = {
  fr: 'Français',
  en: 'English'
}

// Flag emojis for each locale
export const localeFlags: Record<Locale, string> = {
  fr: '🇫🇷',
  en: '🇬🇧'
}
