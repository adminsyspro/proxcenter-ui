// Third-party Imports
import styled from '@emotion/styled'

// Type Imports
import type { RootStylesProps } from '../types'

const StyledMenuLabel = styled.span<RootStylesProps & { textTruncate?: boolean }>`
  flex-grow: 1;
  ${({ textTruncate }) =>
    textTruncate &&
    `
      text-overflow: ellipsis;
      overflow: hidden;
      white-space: nowrap;
    `};
  ${({ rootStyles }) => rootStyles};
`

export default StyledMenuLabel
