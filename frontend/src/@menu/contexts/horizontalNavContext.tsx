'use client'

// React Imports
import { createContext, useMemo, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

// Type Imports
import type { HorizontalNavContextValue } from '../types'

const HorizontalNavContext = createContext({} as HorizontalNavContextValue)

export const HorizontalNavProvider = ({ children }: { children: ReactNode }) => {
  // States
  const [isBreakpointReached, setIsBreakpointReached] = useState(false)

  // Stable callback using useCallback
  const updateIsBreakpointReached = useCallback((value: boolean) => {
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
