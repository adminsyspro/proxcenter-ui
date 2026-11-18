'use client'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'
import useLayoutInit from '@core/hooks/useLayoutInit'

// Type Imports
import type { ReactNode } from 'react'

import type { SystemMode } from '@core/theme/types'

interface LayoutWrapperProps {
  systemMode: SystemMode
  verticalLayout: ReactNode
  horizontalLayout: ReactNode
}

const LayoutWrapper = (props: LayoutWrapperProps) => {
  // Props
  const { systemMode, verticalLayout, horizontalLayout } = props

  // Hooks
  const { settings } = useSettings()

  useLayoutInit(systemMode)

  // Return the layout based on the layout context
  return (
    <div className='flex flex-col flex-auto' data-skin={settings.skin}>
      {settings.layout === 'horizontal' ? horizontalLayout : verticalLayout}
    </div>
  )
}

export default LayoutWrapper
