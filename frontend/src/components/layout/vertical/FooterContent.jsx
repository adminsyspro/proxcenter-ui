'use client'

// Third-party Imports
import classnames from 'classnames'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'
import { useBranding } from '@/contexts/BrandingContext'

// Config Imports
import { APP_VERSION } from '@/config/version'

// Util Imports
import { verticalLayoutClasses } from '@layouts/utils/layoutClasses'

const FooterContent = () => {
  // Hooks
  const { isBreakpointReached } = useVerticalNav()
  const { branding } = useBranding()

  const year = new Date().getFullYear()
  const appName = branding.appName || 'ProxCenter'
  const footerText = branding.footerText || `© ${year} ${appName} - v${APP_VERSION}`

  return (
    <div
      className={classnames(verticalLayoutClasses.footerContent, 'flex items-center justify-between flex-wrap gap-4')}
    >
      <p>
        <span>{footerText}</span>
        {branding.poweredByVisible && branding.appName && branding.appName !== 'ProxCenter' && (
          <span style={{ opacity: 0.5, marginLeft: 8, fontSize: '0.75rem' }}>Powered by ProxCenter</span>
        )}
      </p>
    </div>
  )
}

export default FooterContent
