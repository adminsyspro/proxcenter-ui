'use client'

import { createContext, useContext, useCallback, useTransition } from 'react'
import type { ReactNode } from 'react'

import { useRouter } from 'next/navigation'

import { locales, localeNames, localeFlags, defaultLocale } from '@/i18n/config'
import type { Locale } from '@/i18n/config'

export interface LocaleContextValue {
  locale: string
  locales: readonly Locale[]
  localeNames: Record<Locale, string>
  localeFlags: Record<Locale, string>
  changeLocale: (newLocale: string) => void
  isPending: boolean
}

const isLocale = (value: string): value is Locale => (locales as readonly string[]).includes(value)

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  locales: locales,
  localeNames: localeNames,
  localeFlags: localeFlags,
  changeLocale: () => {},
  isPending: false
})

export const useLocale = () => {
  const context = useContext(LocaleContext)

  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider')
  }

  
return context
}

export const LocaleProvider = ({ children, initialLocale }: { children: ReactNode; initialLocale?: string }) => {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const changeLocale = useCallback((newLocale: string) => {
    if (!isLocale(newLocale)) {
      console.error(`Invalid locale: ${newLocale}`)
      
return
    }

    // Set the locale cookie
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=Lax`

    // Refresh the page to apply the new locale
    startTransition(() => {
      router.refresh()
    })
  }, [router])

  return (
    <LocaleContext.Provider
      value={{
        locale: initialLocale || defaultLocale,
        locales,
        localeNames,
        localeFlags,
        changeLocale,
        isPending
      }}
    >
      {children}
    </LocaleContext.Provider>
  )
}

export default LocaleContext
