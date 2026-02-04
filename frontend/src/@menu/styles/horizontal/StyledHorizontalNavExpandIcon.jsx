// Third-party Imports
import styled from '@emotion/styled'

export const StyledHorizontalNavExpandIconWrapper = styled.span`
  display: flex;
  margin-inline-start: 5px;
  ${({ rootStyles }) => rootStyles};
`

const StyledHorizontalNavExpandIcon = styled.span`
  display: flex;

  ${({ level }) =>
    level === 0 &&
    `
    & > i,
    & > svg {
      transform: rotate(90deg);
    }
  `}

  ${({ level }) =>
    level &&
    level > 0 &&
    `
    [dir='rtl'] & > i,
    [dir='rtl'] & > svg {
      transform: rotate(180deg);
    }
  `}
`

export default StyledHorizontalNavExpandIcon
