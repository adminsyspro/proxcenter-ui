// Third-party Imports
import styled from '@emotion/styled'

// Type Imports
import type { RootStylesProps } from '../types'

const StyledMenuPrefix = styled.span<RootStylesProps & { firstLevel?: boolean; isCollapsed?: boolean; isHovered?: boolean }>`
  margin-inline-end: 5px;
  display: ${({ firstLevel, isCollapsed, isHovered }) => (firstLevel && isCollapsed && !isHovered ? 'none' : 'flex')};
  ${({ rootStyles }) => rootStyles};
`

export default StyledMenuPrefix
