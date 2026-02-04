// Component Imports
import VerticalNav from '../../vertical-menu'

const VerticalNavInHorizontal = props => {
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
