// Third-party Imports
import styled from '@emotion/styled'

// Config Imports
import themeConfig from '@configs/themeConfig'

// Util Imports
import { commonLayoutClasses } from '@layouts/utils/layoutClasses'

const StyledMain = styled.main`
  padding: ${themeConfig.layoutPadding}px;
  padding-block-end: calc(${themeConfig.layoutPadding}px + var(--taskbar-height, 0px));
  flex: 1;
  display: flex;
  flex-direction: column;
  transition: padding-block-end 0.2s ease;
  overflow-y: auto;
  min-block-size: 0;

  ${({ isContentCompact }) =>
    isContentCompact &&
    `
    margin-inline: auto;
    max-inline-size: ${themeConfig.compactContentWidth}px;
  `}

  &:has(.${commonLayoutClasses.contentHeightFixed}) {
    overflow: hidden;
  }

  /* No animation while the taskbar is being drag-resized (TasksFooter #582) */
  html[data-taskbar-resizing] & {
    transition: none;
  }
`

export default StyledMain
