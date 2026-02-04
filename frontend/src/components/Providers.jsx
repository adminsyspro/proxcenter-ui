// Context Imports
import { getLocale } from 'next-intl/server'

import { VerticalNavProvider } from '@menu/contexts/verticalNavContext'
import { SettingsProvider } from '@core/contexts/settingsContext'
import ThemeProvider from '@components/theme'
import AuthProvider from '@components/AuthProvider'
import { RBACProvider } from '@/contexts/RBACContext'
import { PageTitleProvider } from '@/contexts/PageTitleContext'
import { LocaleProvider } from '@/contexts/LocaleContext'
import { LicenseProvider } from '@/contexts/LicenseContext'

// i18n

// Util Imports
import { getMode, getSettingsFromCookie, getSystemMode } from '@core/utils/serverHelpers'

const Providers = async props => {
  // Props
  const { children, direction } = props

  // Vars
  const mode = await getMode()
  const settingsCookie = await getSettingsFromCookie()
  const systemMode = await getSystemMode()
  const locale = await getLocale()

  return (
    <AuthProvider>
      <RBACProvider>
        <LicenseProvider>
          <LocaleProvider initialLocale={locale}>
            <PageTitleProvider>
              <VerticalNavProvider>
                <SettingsProvider settingsCookie={settingsCookie} mode={mode}>
                  <ThemeProvider direction={direction} systemMode={systemMode}>
                    {children}
                  </ThemeProvider>
                </SettingsProvider>
              </VerticalNavProvider>
            </PageTitleProvider>
          </LocaleProvider>
        </LicenseProvider>
      </RBACProvider>
    </AuthProvider>
  )
}

export default Providers
