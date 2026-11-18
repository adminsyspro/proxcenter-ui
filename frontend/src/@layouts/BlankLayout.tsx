'use client'

// Third-party Imports
import classnames from 'classnames'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'
import useLayoutInit from '@core/hooks/useLayoutInit'

// Util Imports
import { blankLayoutClasses } from './utils/layoutClasses'

// Type Imports
import type { ReactNode } from 'react'

import type { SystemMode } from '@core/theme/types'

const BlankLayout = (props: { children: ReactNode; systemMode: SystemMode }) => {
  // Props
  const { children, systemMode } = props

  // Hooks
  const { settings } = useSettings()

  useLayoutInit(systemMode)

  return (
    <div className={classnames(blankLayoutClasses.root, 'is-full bs-full')} data-skin={settings.skin}>
      {children}
    </div>
  )
}

export default BlankLayout
