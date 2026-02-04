// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { menuClasses } from '../../utils/menuClasses'

// Style Imports
import { menuButtonStyles } from '../../components/horizontal-menu/MenuButton'

const StyledHorizontalMenuItem = styled.li`
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
