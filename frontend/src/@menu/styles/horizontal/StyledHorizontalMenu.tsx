// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { menuClasses } from '../../utils/menuClasses'

// Type Imports
import type { RootStylesProps } from '../../types'

const StyledHorizontalMenu = styled.nav<RootStylesProps>`
  &.${menuClasses.root} {
    ${({ rootStyles }) => rootStyles}
  }
`

export default StyledHorizontalMenu
