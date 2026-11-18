// Third-party Imports
import styled from '@emotion/styled'

// Type Imports
import type { ElementStyles } from '../../types'

const StyledHorizontalNav = styled.div<{ customStyles?: ElementStyles }>`
  inline-size: 100%;
  overflow: hidden;
  position: relative;
  ${({ customStyles }) => customStyles}
`

export default StyledHorizontalNav
