'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

export interface PageTitleContextValue {
  title: string
  subtitle: string
  icon: string
  setPageTitle: (title: string) => void
  setPageSubtitle: (subtitle: string) => void
  setPageInfo: (title: string, subtitle?: string | null, icon?: string | null) => void
}

const PageTitleContext = createContext<PageTitleContextValue>({
  title: '',
  subtitle: '',
  icon: '',
  setPageTitle: () => {},
  setPageSubtitle: () => {},
  setPageInfo: () => {}
})

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [icon, setIcon] = useState('')

  const setPageTitle = useCallback((newTitle: string) => {
    setTitle(newTitle)
  }, [])

  const setPageSubtitle = useCallback((newSubtitle: string) => {
    setSubtitle(newSubtitle)
  }, [])

  const setPageInfo = useCallback((newTitle: string, newSubtitle?: string | null, newIcon?: string | null) => {
    setTitle(newTitle)
    setSubtitle(newSubtitle || '')
    setIcon(newIcon || '')
  }, [])

  return (
    <PageTitleContext.Provider value={{
      title,
      subtitle,
      icon,
      setPageTitle,
      setPageSubtitle,
      setPageInfo
    }}>
      {children}
    </PageTitleContext.Provider>
  )
}

export function usePageTitle() {
  return useContext(PageTitleContext)
}

export default PageTitleContext