'use client'

// React Imports
import { createContext, useCallback, useMemo, useState } from 'react'

const VerticalNavContext = createContext({})

export const VerticalNavProvider = ({ children }) => {
  // States
  const [verticalNavState, setVerticalNavState] = useState()

  // Hooks
  const updateVerticalNavState = useCallback(values => {
    setVerticalNavState(prevState => ({
      ...prevState,
      ...values,
      collapsing: values.isCollapsed === true,
      expanding: values.isCollapsed === false
    }))
  }, [])

  const collapseVerticalNav = useCallback(value => {
    setVerticalNavState(prevState => ({
      ...prevState,
      isHovered: value !== undefined && false,
      isCollapsed: value !== undefined ? Boolean(value) : !Boolean(prevState?.isCollapsed),
      collapsing: value === true,
      expanding: value !== true
    }))
  }, [])

  const hoverVerticalNav = useCallback(value => {
    setVerticalNavState(prevState => ({
      ...prevState,
      isHovered: value !== undefined ? Boolean(value) : !Boolean(prevState?.isHovered)
    }))
  }, [])

  const toggleVerticalNav = useCallback(value => {
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
