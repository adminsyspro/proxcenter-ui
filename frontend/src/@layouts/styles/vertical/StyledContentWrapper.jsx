'use client'

// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { commonLayoutClasses, verticalLayoutClasses } from '@layouts/utils/layoutClasses'

const StyledContentWrapper = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  /* A fixed top banner (broadcast or demo mode) publishes its height here.
     Unset resolves to 0px, so the layout is untouched without a banner.
     box-sizing is border-box globally, so min-height still totals 100vh. */
  padding-block-start: var(--top-banner-height, 0px);
  transition: padding-block-start 0.2s ease;

  &:has(.${verticalLayoutClasses.content}>.${commonLayoutClasses.contentHeightFixed}) {
    max-block-size: 100dvh;
  }
`

export default StyledContentWrapper
