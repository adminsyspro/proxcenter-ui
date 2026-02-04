// Third-party Imports
import styled from '@emotion/styled'
import classnames from 'classnames'

// Component Imports
import HorizontalMenu from './HorizontalMenu'

// Config Imports
import themeConfig from '@configs/themeConfig'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'
import useHorizontalNav from '@menu/hooks/useHorizontalNav'

// Util Imports
import { horizontalLayoutClasses } from '@layouts/utils/layoutClasses'

const StyledDiv = styled.div`
  ${({ isContentCompact, isBreakpointReached }) =>
    !isBreakpointReached &&
    `
    padding: ${themeConfig.layoutPadding}px;

    ${
      isContentCompact &&
      `
      margin-inline: auto;
      max-inline-size: ${themeConfig.compactContentWidth}px;
    `
    }
  `}
`

const Navigation = () => {
  // Hooks
  const { settings } = useSettings()
  const { isBreakpointReached } = useHorizontalNav()

  // Vars
  const headerContentCompact = settings.navbarContentWidth === 'compact'

  return (
    <div
      {...(!isBreakpointReached && {
        className: classnames(horizontalLayoutClasses.navigation, 'relative flex border-bs')
      })}
    >
      <StyledDiv
        isContentCompact={headerContentCompact}
        isBreakpointReached={isBreakpointReached}
        {...(!isBreakpointReached && {
          className: classnames(horizontalLayoutClasses.navigationContentWrapper, 'flex items-center is-full plb-2.5')
        })}
      >
        <HorizontalMenu />
      </StyledDiv>
    </div>
  )
}

export default Navigation
