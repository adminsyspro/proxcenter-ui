// Component Imports
import VerticalNav from '../../vertical-menu'

// Type Imports
import type { ReactNode } from 'react'

import type { BreakpointType, VerticalNavProps } from '../../types'

interface VerticalNavInHorizontalProps {
  children?: ReactNode
  className?: string
  breakpoint?: BreakpointType
  customBreakpoint?: string
  verticalNavProps?: VerticalNavProps
}

const VerticalNavInHorizontal = (props: VerticalNavInHorizontalProps) => {
  // Props
  const { children, className, breakpoint, customBreakpoint, verticalNavProps } = props

  return (
    <VerticalNav
      {...verticalNavProps}
      className={className}
      breakpoint={breakpoint}
      customBreakpoint={customBreakpoint}
    >
      {children}
    </VerticalNav>
  )
}

export default VerticalNavInHorizontal
