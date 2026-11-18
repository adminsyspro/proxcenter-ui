// Third-party Imports
import styled from '@emotion/styled'

// Type Imports
import type { RootStylesProps } from '../types'

const StyledMenuSectionLabel = styled.span<RootStylesProps & { textTruncate?: boolean; isCollapsed?: boolean; isHovered?: boolean }>`
  ${({ textTruncate }) =>
    textTruncate &&
    `
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `};
  ${({ isCollapsed, isHovered }) =>
    !isCollapsed || (isCollapsed && isHovered)
      ? `
flex-grow: 1;
`
      : ''}
  ${({ rootStyles }) => rootStyles};
`

export default StyledMenuSectionLabel
