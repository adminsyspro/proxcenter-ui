// MUI Imports
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript'

// Third-party Imports
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'

// Context Imports
import { BrandingProvider } from '@/contexts/BrandingContext'
import AuthProvider from '@components/AuthProvider'

// Util Imports
import { getSystemMode } from '@core/utils/serverHelpers'

// Style Imports
import '@/app/globals.css'

// Generated Icon CSS Imports
import '@assets/iconify-icons/generated-icons.css'

// Type Imports
import type { ReactNode } from 'react'

export const metadata = {
  title: 'PROXCENTER',
  description:
    'PROXCENTER ADMIN UI'
}

const RootLayout = async (props: { children: ReactNode }) => {
  const { children } = props

  // Get locale and messages for i18n
  const locale = await getLocale()
  const messages = await getMessages()

  // Vars
  const systemMode = await getSystemMode()
  const direction = 'ltr'

  return (
    <html id='__next' lang={locale} dir={direction} suppressHydrationWarning>
      <body className='flex is-full min-bs-full flex-auto flex-col'>
        <InitColorSchemeScript attribute='data' defaultMode={systemMode} />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* SessionProvider lives at the root so BrandingProvider (which now
              subscribes to the session to refetch on login / tenant switch)
              has access to it. The dashboard's Providers no longer wraps an
              AuthProvider — the single instance here covers /login, /setup,
              and the authenticated dashboard tree alike. */}
          <AuthProvider>
            <BrandingProvider>
              {children}
            </BrandingProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}

export default RootLayout
