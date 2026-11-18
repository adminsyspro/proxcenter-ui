// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { menuClasses } from '../../utils/menuClasses'

// Style Imports
import { menuButtonStyles } from '../../components/vertical-menu/MenuButton'

// Type Imports
import type { ElementStyles, RootStylesProps } from '../../types'

interface StyledVerticalMenuItemProps extends RootStylesProps {
  level: number
  disabled?: boolean
  isCollapsed?: boolean
  isPopoutWhenCollapsed?: boolean
  menuItemStyles?: ElementStyles
  buttonStyles?: ElementStyles
}

const StyledVerticalMenuItem = styled.li<StyledVerticalMenuItemProps>`
  position: relative;
  margin-block-start: 4px;
  ${({ menuItemStyles }) => menuItemStyles};
  ${({ rootStyles }) => rootStyles};

  > .${menuClasses.button} {
    ${({ level, disabled, isCollapsed, isPopoutWhenCollapsed }) =>
      menuButtonStyles({
        level,
        disabled,
        isCollapsed,
        isPopoutWhenCollapsed
      })};
    ${({ buttonStyles }) => buttonStyles};
  }
`

export default StyledVerticalMenuItem
