// Third-party Imports
import styled from '@emotion/styled'

const StyledMenuSuffix = styled.span`
  margin-inline-start: 5px;
  display: ${({ firstLevel, isCollapsed, isHovered }) => (firstLevel && isCollapsed && !isHovered ? 'none' : 'flex')};
  ${({ rootStyles }) => rootStyles};
`

export default StyledMenuSuffix
