// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { horizontalNavClasses, menuClasses, verticalNavClasses } from '../../utils/menuClasses'

const StyledVerticalNav = styled.aside`
  ${({ scrollWithContent }) =>
    !scrollWithContent &&
    `
    position: sticky;
    inset-block-start: 0;
    block-size: 100dvh;
  `}
  z-index: 9;

  /* Transition */
  transition-property: inline-size, min-inline-size, margin-inline-start, inset-inline-start;
  transition-duration: ${({ transitionDuration }) => `${transitionDuration}ms`};
  transition-timing-function: ease-in-out;

  /* Width & Min Width & Margin */
  inline-size: ${({ width }) => `${width}px`};
  min-inline-size: ${({ width }) => `${width}px`};
  &.${verticalNavClasses.collapsed} {
    inline-size: ${({ collapsedWidth }) => `${collapsedWidth}px`};
    min-inline-size: ${({ collapsedWidth }) => `${collapsedWidth}px`};
  }

  &.${verticalNavClasses.collapsing}, &.${verticalNavClasses.expanding} {
    pointer-events: none;
  }

  /* Collapsed & Toggled */
  &.${verticalNavClasses.breakpointReached} {
    position: fixed;
    block-size: 100%;
    inset-block-start: 0;
    inset-inline-start: ${({ width }) => `-${width}px`};
    z-index: 100;
    margin: 0;
    &.${verticalNavClasses.collapsed} {
      inset-inline-start: -${({ collapsedWidth }) => `${collapsedWidth}px`};
    }
    &.${verticalNavClasses.toggled} {
      inset-inline-start: 0;
    }
  }

  ${({ width, isBreakpointReached }) =>
    !isBreakpointReached &&
    `
    &.${verticalNavClasses.toggled} {
      margin-inline-start: -${width}px;
    }
  `}

  &.${horizontalNavClasses.root} .${menuClasses.root} > ul {
    flex-direction: column;
    align-items: stretch;
  }

  /* User Styles */
  ${({ customStyles }) => customStyles}
`

export default StyledVerticalNav
