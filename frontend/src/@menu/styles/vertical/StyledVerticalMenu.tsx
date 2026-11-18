// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { menuClasses } from '../../utils/menuClasses'

// Type Imports
import type { RootStylesProps } from '../../types'

const StyledVerticalMenu = styled.nav<RootStylesProps>`
  & > ul > :first-of-type {
    margin-block-start: 0;
  }
  &.${menuClasses.root} {
    ${({ rootStyles }) => rootStyles}
  }
`

export default StyledVerticalMenu
