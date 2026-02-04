'use client'

// React Imports
import { createContext, useMemo, useState, useCallback } from 'react'

const HorizontalNavContext = createContext({})

export const HorizontalNavProvider = ({ children }) => {
  // States
  const [isBreakpointReached, setIsBreakpointReached] = useState(false)

  // Stable callback using useCallback
  const updateIsBreakpointReached = useCallback(value => {
    setIsBreakpointReached(value)
  }, [])

  // Hooks
  const HorizontalNavProviderValue = useMemo(
    () => ({
      isBreakpointReached,
      updateIsBreakpointReached
    }),
    [isBreakpointReached, updateIsBreakpointReached]
  )

  return <HorizontalNavContext.Provider value={HorizontalNavProviderValue}>{children}</HorizontalNavContext.Provider>
}

export default HorizontalNavContext
