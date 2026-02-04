'use client'

import { createContext, useContext, useState, useCallback } from 'react'

const SidebarContext = createContext(null)

export const SidebarProvider = ({ children }) => {
  const [isHiddenHovered, setIsHiddenHovered] = useState(false)

  const setHovered = useCallback((value) => {
    setIsHiddenHovered(value)
  }, [])

  return (
    <SidebarContext.Provider value={{ isHiddenHovered, setHovered }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return context
}
