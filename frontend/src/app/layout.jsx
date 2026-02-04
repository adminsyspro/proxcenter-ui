// MUI Imports
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript'

// Third-party Imports
import 'react-perfect-scrollbar/dist/css/styles.css'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'

// Util Imports
import { getSystemMode } from '@core/utils/serverHelpers'

// Style Imports
import '@/app/globals.css'

// Generated Icon CSS Imports
import '@assets/iconify-icons/generated-icons.css'

export const metadata = {
  title: 'PROXCENTER',
  description:
    'PROXCENTER ADMIN UI'
}

const RootLayout = async props => {
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
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}

export default RootLayout
