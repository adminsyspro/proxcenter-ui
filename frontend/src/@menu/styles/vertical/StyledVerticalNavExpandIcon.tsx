// Third-party Imports
import styled from '@emotion/styled'

// Type Imports
import type { RootStylesProps } from '../../types'

export const StyledVerticalNavExpandIconWrapper = styled.span<RootStylesProps>`
  display: flex;
  margin-inline-start: 5px;
  ${({ rootStyles }) => rootStyles};
`

const StyledVerticalNavExpandIcon = styled.span<{ open?: boolean; transitionDuration?: number }>`
  display: flex;

  & > i,
  & > svg {
    transition: ${({ transitionDuration }) => `transform ${transitionDuration}ms ease-in-out`};
    ${({ open }) => open && 'transform: rotate(90deg);'}

    [dir='rtl'] & {
      transform: rotate(180deg);
      ${({ open }) => open && 'transform: rotate(90deg);'}
    }
  }
`

export default StyledVerticalNavExpandIcon
