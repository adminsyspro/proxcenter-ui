'use client'

// Third-party Imports
import styled from '@emotion/styled'

// Util Imports
import { commonLayoutClasses, horizontalLayoutClasses } from '@layouts/utils/layoutClasses'

const StyledContentWrapper = styled.div`
  &:has(.${horizontalLayoutClasses.content}>.${commonLayoutClasses.contentHeightFixed}) {
    max-block-size: 100dvh;
  }
`

export default StyledContentWrapper
