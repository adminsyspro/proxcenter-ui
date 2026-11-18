// Third-party Imports
import styled from '@emotion/styled'

// Type Imports
import type { RootStylesProps } from '../../types'

const StyledHorizontalSubMenuContentWrapper = styled.div<RootStylesProps>`
  z-index: 10;

  ${({ rootStyles }) => rootStyles};
`

export default StyledHorizontalSubMenuContentWrapper
