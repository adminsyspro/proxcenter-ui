// Third-party Imports
import styled from '@emotion/styled'

// Hook Imports
import useVerticalNav from '../../hooks/useVerticalNav'

// Util Imports
import { verticalNavClasses } from '../../utils/menuClasses'

// Type Imports
import type { ReactNode } from 'react'

const StyledNavHeader = styled.div<{ isHovered?: boolean; isCollapsed?: boolean; collapsedWidth?: number; transitionDuration?: number }>`
  padding: 15px;
  padding-inline-start: 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: ${({ transitionDuration }) => `padding-inline ${transitionDuration}ms ease-in-out`};

  ${({ isHovered, isCollapsed, collapsedWidth }) =>
    isCollapsed && !isHovered && `padding-inline: calc((${collapsedWidth}px - 1px - 22px) / 2);`}
`

const NavHeader = ({ children }: { children: ReactNode }) => {
  // Hooks
  const { isHovered, isCollapsed, collapsedWidth, transitionDuration } = useVerticalNav()

  return (
    <StyledNavHeader
      className={verticalNavClasses.header}
      isHovered={isHovered}
      isCollapsed={isCollapsed}
      collapsedWidth={collapsedWidth}
      transitionDuration={transitionDuration}
    >
      {children}
    </StyledNavHeader>
  )
}

export default NavHeader
