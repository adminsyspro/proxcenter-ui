'use client'

// React Imports
import { createContext, useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

// Type Imports
import type { VerticalNavContextValue, VerticalNavState } from '../types'

const VerticalNavContext = createContext({} as VerticalNavContextValue)

export const VerticalNavProvider = ({ children }: { children: ReactNode }) => {
  // States
  const [verticalNavState, setVerticalNavState] = useState<VerticalNavState>({ isCollapsed: true })

  // Hooks
  const updateVerticalNavState = useCallback((values: VerticalNavState) => {
    setVerticalNavState(prevState => ({
      ...prevState,
      ...values,
      collapsing: values.isCollapsed === true,
      expanding: values.isCollapsed === false
    }))
  }, [])

  const collapseVerticalNav = useCallback((value?: boolean) => {
    setVerticalNavState(prevState => ({
      ...prevState,
      isHovered: value !== undefined && false,
      isCollapsed: value !== undefined ? Boolean(value) : !Boolean(prevState?.isCollapsed),
      collapsing: value === true,
      expanding: value !== true
    }))
  }, [])

  const hoverVerticalNav = useCallback((value?: boolean) => {
    setVerticalNavState(prevState => ({
      ...prevState,
      isHovered: value !== undefined ? Boolean(value) : !Boolean(prevState?.isHovered)
    }))
  }, [])

  const toggleVerticalNav = useCallback((value?: boolean) => {
    setVerticalNavState(prevState => ({
      ...prevState,
      isToggled: value !== undefined ? Boolean(value) : !Boolean(prevState?.isToggled)
    }))
  }, [])

  const verticalNavProviderValue = useMemo(
    () => ({
      ...verticalNavState,
      updateVerticalNavState,
      collapseVerticalNav,
      hoverVerticalNav,
      toggleVerticalNav
    }),
    [verticalNavState, updateVerticalNavState, collapseVerticalNav, hoverVerticalNav, toggleVerticalNav]
  )

  return <VerticalNavContext.Provider value={verticalNavProviderValue}>{children}</VerticalNavContext.Provider>
}

export default VerticalNavContext
