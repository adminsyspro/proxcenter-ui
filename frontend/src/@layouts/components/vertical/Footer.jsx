'use client'

// MUI Imports
import { useTheme } from '@mui/material/styles'

// Third-party Imports
import classnames from 'classnames'

// Config Imports
import themeConfig from '@configs/themeConfig'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

// Util Imports
import { verticalLayoutClasses } from '@layouts/utils/layoutClasses'

// Styled Component Imports
import StyledFooter from '@layouts/styles/vertical/StyledFooter'

const Footer = props => {
  // Props
  const { children, overrideStyles } = props

  // Hooks
  const { settings } = useSettings()
  const theme = useTheme()

  // Vars
  const { footerContentWidth } = settings
  const footerDetached = themeConfig.footer.detached === true
  const footerAttached = themeConfig.footer.detached === false
  const footerStatic = themeConfig.footer.type === 'static'
  const footerFixed = themeConfig.footer.type === 'fixed'
  const footerContentCompact = footerContentWidth === 'compact'
  const footerContentWide = footerContentWidth === 'wide'

  return (
    <StyledFooter
      theme={theme}
      overrideStyles={overrideStyles}
      className={classnames(verticalLayoutClasses.footer, 'is-full', {
        [verticalLayoutClasses.footerDetached]: footerDetached,
        [verticalLayoutClasses.footerAttached]: footerAttached,
        [verticalLayoutClasses.footerStatic]: footerStatic,
        [verticalLayoutClasses.footerFixed]: footerFixed,
        [verticalLayoutClasses.footerContentCompact]: footerContentCompact,
        [verticalLayoutClasses.footerContentWide]: footerContentWide
      })}
    >
      <div className={verticalLayoutClasses.footerContentWrapper}>{children}</div>
    </StyledFooter>
  )
}

export default Footer
