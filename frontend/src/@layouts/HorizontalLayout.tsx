// Third-party Imports
import classnames from 'classnames'

// Context Imports
import { HorizontalNavProvider } from '@menu/contexts/horizontalNavContext'

// Component Imports
import LayoutContent from './components/horizontal/LayoutContent'

// Util Imports
import { horizontalLayoutClasses } from './utils/layoutClasses'

// Styled Component Imports
import StyledContentWrapper from './styles/horizontal/StyledContentWrapper'

// Type Imports
import type { ReactNode } from 'react'

const HorizontalLayout = (props: { header?: ReactNode; footer?: ReactNode; children: ReactNode }) => {
  // Props
  const { header, footer, children } = props

  return (
    <div className={classnames(horizontalLayoutClasses.root, 'flex flex-auto')}>
      <HorizontalNavProvider>
        <StyledContentWrapper className={classnames(horizontalLayoutClasses.contentWrapper, 'flex flex-col is-full')}>
          {header || null}
          <LayoutContent>{children}</LayoutContent>
          {footer || null}
        </StyledContentWrapper>
      </HorizontalNavProvider>
    </div>
  )
}

export default HorizontalLayout
