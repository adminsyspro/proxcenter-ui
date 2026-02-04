'use client'

// React Imports
import { useEffect } from 'react'

// Hook Imports
import { useCookie, useMedia } from 'react-use'

// Type Imports
import { useColorScheme } from '@mui/material'

import { useSettings } from '@core/hooks/useSettings'

const useLayoutInit = colorSchemeFallback => {
  // Hooks
  const { settings } = useSettings()
  const { setMode } = useColorScheme()

  const [_, updateCookieColorPref] = useCookie('colorPref')
  const isDark = useMedia('(prefers-color-scheme: dark)', colorSchemeFallback === 'dark')

  useEffect(() => {
    const appMode = isDark ? 'dark' : 'light'

    updateCookieColorPref(appMode)

    if (settings.mode === 'system') {
      // We need to change the mode in settings context to apply the mode change to MUI components
      setMode(appMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark])

  // This hook does not return anything as it is only used to initialize color preference cookie and settings context on first load
}

export default useLayoutInit
