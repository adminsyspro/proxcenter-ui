// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { verticalNavClasses } from '../../utils/menuClasses'

const StyledVerticalNavContainer = styled.div`
  position: relative;
  block-size: 100%;
  inline-size: 100%;
  border-inline-end: 1px solid #efefef;
  .${verticalNavClasses.hovered} &,
  .${verticalNavClasses.expanding} & {
    inline-size: ${({ width }) => `${width}px`};
  }

  /* Transition */
  transition-property: inline-size, inset-inline-start;
  transition-duration: ${({ transitionDuration }) => `${transitionDuration}ms`};
  transition-timing-function: ease-in-out;
`

export default StyledVerticalNavContainer
