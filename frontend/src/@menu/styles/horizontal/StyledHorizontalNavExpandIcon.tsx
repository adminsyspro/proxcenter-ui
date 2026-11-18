// Third-party Imports
import styled from '@emotion/styled'

// Type Imports
import type { RootStylesProps } from '../../types'

export const StyledHorizontalNavExpandIconWrapper = styled.span<RootStylesProps>`
  display: flex;
  margin-inline-start: 5px;
  ${({ rootStyles }) => rootStyles};
`

const StyledHorizontalNavExpandIcon = styled.span<{ level?: number }>`
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
