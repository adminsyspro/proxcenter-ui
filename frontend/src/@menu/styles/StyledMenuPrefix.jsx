// Third-party Imports
import styled from '@emotion/styled'

const StyledMenuPrefix = styled.span`
  margin-inline-end: 5px;
  display: ${({ firstLevel, isCollapsed, isHovered }) => (firstLevel && isCollapsed && !isHovered ? 'none' : 'flex')};
  ${({ rootStyles }) => rootStyles};
`

export default StyledMenuPrefix
