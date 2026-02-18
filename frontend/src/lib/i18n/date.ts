const localeMap: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-US',
}

export function getDateLocale(locale: string): string {
  return localeMap[locale] || 'en-US'
}

export function formatDateTime(date: Date | number, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'number' ? new Date(date) : date
  return d.toLocaleString(getDateLocale(locale), options)
}

export function formatDate(date: Date | number, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'number' ? new Date(date) : date
  return d.toLocaleDateString(getDateLocale(locale), options)
}

export function formatTime(date: Date | number, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'number' ? new Date(date) : date
  return d.toLocaleTimeString(getDateLocale(locale), options)
}
