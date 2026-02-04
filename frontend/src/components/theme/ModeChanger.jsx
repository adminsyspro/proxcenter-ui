// React Imports
import { useEffect } from 'react'

// MUI Imports
import { useColorScheme } from '@mui/material/styles'

// Third-party Imports
import { useMedia } from 'react-use'

// Hook Imports
import { useSettings } from '@core/hooks/useSettings'

const ModeChanger = ({ systemMode }) => {
  // Hooks
  const { setMode } = useColorScheme()
  const { settings } = useSettings()
  const isDark = useMedia('(prefers-color-scheme: dark)', systemMode === 'dark')

  useEffect(() => {
    if (settings.mode) {
      if (settings.mode === 'system') {
        setMode(isDark ? 'dark' : 'light')
      } else {
        setMode(settings.mode)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode])

  return null
}

export default ModeChanger
