// Third-party Imports
import styled from '@emotion/styled'

const StyledMenuSectionLabel = styled.span`
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
