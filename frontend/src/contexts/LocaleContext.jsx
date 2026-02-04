'use client'

import { createContext, useContext, useCallback, useTransition } from 'react'

import { useRouter } from 'next/navigation'

import { locales, localeNames, localeFlags, defaultLocale } from '@/i18n/config'

const LocaleContext = createContext({
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

export const LocaleProvider = ({ children, initialLocale }) => {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const changeLocale = useCallback((newLocale) => {
    if (!locales.includes(newLocale)) {
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
