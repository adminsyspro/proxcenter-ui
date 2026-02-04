// Third-party Imports
import styled from '@emotion/styled'

// Config Imports
import themeConfig from '@configs/themeConfig'

// Util Imports
import { commonLayoutClasses } from '@layouts/utils/layoutClasses'

const StyledMain = styled.main`
  padding: ${themeConfig.layoutPadding}px;
  flex: 1;
  display: flex;
  flex-direction: column;
  
  ${({ isContentCompact }) =>
    isContentCompact &&
    `
    margin-inline: auto;
    max-inline-size: ${themeConfig.compactContentWidth}px;
  `}

  &:has(.${commonLayoutClasses.contentHeightFixed}) {
    overflow: hidden;
  }
`

export default StyledMain
