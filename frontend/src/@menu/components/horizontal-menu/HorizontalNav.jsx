'use client'

// React Imports
import { useEffect, useRef } from 'react'

// Third-party Imports
import classnames from 'classnames'

// Component Imports
import VerticalNavInHorizontal from './VerticalNavInHorizontal'

// Hook Imports
import useMediaQuery from '../../hooks/useMediaQuery'
import useHorizontalNav from '../../hooks/useHorizontalNav'

// Util Imports
import { horizontalNavClasses } from '../../utils/menuClasses'

// Styled Component Imports
import StyledHorizontalNav from '../../styles/horizontal/StyledHorizontalNav'

// Default Config Imports
import { defaultBreakpoints } from '../../defaultConfigs'

const HorizontalNav = props => {
  // Props
  const {
    switchToVertical = false,
    hideMenu = false,
    breakpoint = 'lg',
    customBreakpoint,
    breakpoints,
    customStyles,
    className,
    children,
    verticalNavProps,
    verticalNavContent: VerticalNavContent
  } = props

  // Vars
  const mergedBreakpoints = { ...defaultBreakpoints, ...breakpoints }
  const horizontalMenuClasses = classnames(horizontalNavClasses.root, className)

  // Refs
  const prevBreakpoint = useRef(false)

  // Hooks
  const { updateIsBreakpointReached } = useHorizontalNav()

  // Find the breakpoint from which screen size responsive behavior should enable and if its reached or not
  const breakpointReached = useMediaQuery(customBreakpoint ?? (breakpoint ? mergedBreakpoints[breakpoint] : breakpoint))

  // Set the breakpointReached value in the state
  useEffect(() => {
    if (prevBreakpoint.current === breakpointReached) return
    updateIsBreakpointReached(breakpointReached)
    prevBreakpoint.current = breakpointReached
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakpointReached])

  // If switchToVertical is true, then render the VerticalNav component if breakpoint is reached
  if (switchToVertical && breakpointReached) {
    return (
      <VerticalNavInHorizontal
        breakpoint={breakpoint}
        className={horizontalMenuClasses}
        customBreakpoint={customBreakpoint}
        verticalNavProps={verticalNavProps}
      >
        {VerticalNavContent && <VerticalNavContent>{children}</VerticalNavContent>}
      </VerticalNavInHorizontal>
    )
  }

  // If hideMenu is true, then hide the HorizontalNav component if breakpoint is reached
  if (hideMenu && breakpointReached) {
    return null
  }

  // If switchToVertical & hideMenu are false, then render the HorizontalNav component
  return (
    <StyledHorizontalNav customStyles={customStyles} className={horizontalMenuClasses}>
      {children}
    </StyledHorizontalNav>
  )
}

export default HorizontalNav
