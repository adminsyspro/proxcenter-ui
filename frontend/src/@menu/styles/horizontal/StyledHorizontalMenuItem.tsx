// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { menuClasses } from '../../utils/menuClasses'

// Style Imports
import { menuButtonStyles } from '../../components/horizontal-menu/MenuButton'

// Type Imports
import type { ElementStyles, RootStylesProps } from '../../types'

interface StyledHorizontalMenuItemProps extends RootStylesProps {
  level: number
  disabled?: boolean
  menuItemStyles?: ElementStyles
  buttonStyles?: ElementStyles
}

const StyledHorizontalMenuItem = styled.li<StyledHorizontalMenuItemProps>`
  position: relative;
  ${({ level }) => level === 0 && { borderRadius: '6px', overflow: 'hidden' }}
  ${({ menuItemStyles }) => menuItemStyles};
  ${({ rootStyles }) => rootStyles};

  > .${menuClasses.button} {
    ${({ level, disabled }) =>
      menuButtonStyles({
        level,
        disabled
      })};
    ${({ buttonStyles }) => buttonStyles};
  }
`

export default StyledHorizontalMenuItem
