// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { menuClasses } from '../../utils/menuClasses'

// Type Imports
import type { ElementStyles, RootStylesProps } from '../../types'

const StyledVerticalMenuSection = styled.li<RootStylesProps & { menuSectionStyles?: ElementStyles }>`
  display: flex;
  inline-size: 100%;
  position: relative;
  overflow: hidden;
  margin-block-start: 15px;

  & .${menuClasses.menuSectionContent} {
    font-size: 14px;
    color: #aaaaaa;
  }

  ${({ menuSectionStyles }) => menuSectionStyles};
  ${({ rootStyles }) => rootStyles};
`

export default StyledVerticalMenuSection
