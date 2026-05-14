// Context Imports
import { getLocale } from 'next-intl/server'

import { VerticalNavProvider } from '@menu/contexts/verticalNavContext'
import { SettingsProvider } from '@core/contexts/settingsContext'
import ThemeProvider from '@components/theme'

// AuthProvider (SessionProvider) is mounted at the root layout so that
// BrandingProvider — also at the root — can react to session changes and
// fetch the right tenant's white-label on login / tenant switch.
import { RBACProvider } from '@/contexts/RBACContext'
import { PageTitleProvider } from '@/contexts/PageTitleContext'
import { LocaleProvider } from '@/contexts/LocaleContext'
import { LicenseProvider } from '@/contexts/LicenseContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { TenantProvider } from '@/contexts/TenantContext'

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
    <TenantProvider>
      <RBACProvider>
        <LicenseProvider>
          <LocaleProvider initialLocale={locale}>
            <PageTitleProvider>
              <VerticalNavProvider>
                <SettingsProvider settingsCookie={settingsCookie} mode={mode}>
                  <ThemeProvider direction={direction} systemMode={systemMode}>
                    <ToastProvider>
                      {children}
                    </ToastProvider>
                  </ThemeProvider>
                </SettingsProvider>
              </VerticalNavProvider>
            </PageTitleProvider>
          </LocaleProvider>
        </LicenseProvider>
      </RBACProvider>
    </TenantProvider>
  )
}

export default Providers
