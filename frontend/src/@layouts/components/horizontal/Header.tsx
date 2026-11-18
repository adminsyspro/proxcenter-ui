// MUI Imports
import { useTheme } from '@mui/material/styles'
import { useColorScheme } from '@mui/material'

// Third-party Imports
import classnames from 'classnames'

// Config Imports
import themeConfig from '@configs/themeConfig'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

// Util Imports
import { horizontalLayoutClasses } from '@layouts/utils/layoutClasses'

// Styled Component Imports
import StyledHeader from '@layouts/styles/horizontal/StyledHeader'

// Type Imports
import type { ReactNode } from 'react'

import type { CSSObject } from '@emotion/react'

const Header = (props: { children: ReactNode; overrideStyles?: CSSObject }) => {
  // Props
  const { children, overrideStyles } = props

  // Hooks
  const { settings } = useSettings()
  const theme = useTheme()
  const { mode: muiMode, systemMode: muiSystemMode } = useColorScheme()

  // Vars
  const { navbarContentWidth } = settings
  const headerFixed = themeConfig.navbar.type === 'fixed'
  const headerStatic = themeConfig.navbar.type === 'static'
  const headerBlur = themeConfig.navbar.blur === true
  const headerContentCompact = navbarContentWidth === 'compact'
  const headerContentWide = navbarContentWidth === 'wide'

  // Semi-dark: apply dark CSS variables on header in light mode (like vertical sidebar)
  const isSemiDark = settings.semiDark
  const currentMode = muiMode === 'system' ? muiSystemMode : muiMode
  const isDark = currentMode === 'dark'

  return (
    <StyledHeader
      theme={theme}
      overrideStyles={overrideStyles}
      className={classnames(horizontalLayoutClasses.header, {
        [horizontalLayoutClasses.headerFixed]: headerFixed,
        [horizontalLayoutClasses.headerStatic]: headerStatic,
        [horizontalLayoutClasses.headerBlur]: headerBlur,
        [horizontalLayoutClasses.headerContentCompact]: headerContentCompact,
        [horizontalLayoutClasses.headerContentWide]: headerContentWide
      })}
      {...(isSemiDark && !isDark && { 'data-dark': '' })}
    >
      {children}
    </StyledHeader>
  )
}

export default Header
