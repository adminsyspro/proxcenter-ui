// src/i18n/request.ts
import { cookies, headers } from 'next/headers'

import { getRequestConfig } from 'next-intl/server'

import { defaultLocale, locales, type Locale } from './config'

export default getRequestConfig(async () => {
  // Try to get locale from cookie first
  const cookieStore = await cookies()
  let locale = cookieStore.get('NEXT_LOCALE')?.value as Locale | undefined

  // If no cookie, try Accept-Language header
  if (!locale) {
    const headerStore = await headers()
    const acceptLanguage = headerStore.get('accept-language')

    if (acceptLanguage) {
      // Parse Accept-Language header and find first matching locale
      const browserLocales = acceptLanguage
        .split(',')
        .map(l => l.split(';')[0].trim().substring(0, 2).toLowerCase())

      locale = browserLocales.find(l => locales.includes(l as Locale)) as Locale
    }
  }

  // Fallback to default locale
  if (!locale || !locales.includes(locale)) {
    locale = defaultLocale
  }

  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default
  }
})
