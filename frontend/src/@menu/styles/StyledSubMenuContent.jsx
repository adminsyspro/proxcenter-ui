// Third-party Imports
import styled from '@emotion/styled'

const StyledSubMenuContent = styled.div`
  display: none;
  overflow: hidden;
  z-index: 999;
  transition: ${({ transitionDuration }) => `block-size ${transitionDuration}ms ease-in-out`};
  box-sizing: border-box;

  ${({ isCollapsed, level, isPopoutWhenCollapsed, isHovered }) =>
    isCollapsed &&
    level === 0 &&
    !isPopoutWhenCollapsed &&
    !isHovered &&
    `
      block-size: 0 !important;
    `}

  ${({ isCollapsed, level, isPopoutWhenCollapsed }) =>
    isCollapsed && level === 0 && isPopoutWhenCollapsed
      ? `
      display: block;
      padding-inline-start: 0px;
      inline-size: 260px;
      border-radius: 4px;
      block-size: auto !important;
      transition: none !important;
      background-color: white;
      box-shadow: 0 3px 6px -4px #0000001f, 0 6px 16px #00000014, 0 9px 28px 8px #0000000d;
     `
      : `
      position: static !important;
      transform: none !important;
      `}

  ${({ browserScroll }) => browserScroll && `overflow-y: auto; max-block-size: calc((var(--vh, 1vh) * 100));`}


  ${({ rootStyles }) => rootStyles};
`

export default StyledSubMenuContent
