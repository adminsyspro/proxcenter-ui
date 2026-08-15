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
import { getMode, getEffectiveSettings, getSystemMode } from '@core/utils/serverHelpers'
import { getAppearanceHydration } from '@/lib/appearance/server'

const Providers = async props => {
  // Props
  const { children, direction } = props

  // Vars
  const mode = await getMode()

  // The appearance the user saved wins over their cookie, and it is resolved
  // here on the server so the right palette is in the very first HTML instead
  // of replacing the default orange after hydration (issue #696).
  const initialSettings = await getEffectiveSettings()
  const appearance = await getAppearanceHydration()
  const systemMode = await getSystemMode()
  const locale = await getLocale()

  return (
    <TenantProvider>
      <RBACProvider>
        <LicenseProvider>
          <LocaleProvider initialLocale={locale}>
            <PageTitleProvider>
              <VerticalNavProvider>
                <SettingsProvider
                  initialSettings={initialSettings}
                  canPersistAppearance={appearance.authenticated}
                  hasStoredAppearance={appearance.stored !== null}
                  appearanceOwner={appearance.userId}
                  mode={mode}
                >
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
