'use client'

import { createContext, useContext, useState, useCallback } from 'react'

const PageTitleContext = createContext({
  title: '',
  subtitle: '',
  icon: '',
  setPageTitle: (title) => {},
  setPageSubtitle: (subtitle) => {},
  setPageInfo: (title, subtitle, icon) => {}
})

export function PageTitleProvider({ children }) {
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [icon, setIcon] = useState('')

  const setPageTitle = useCallback((newTitle) => {
    setTitle(newTitle)
  }, [])

  const setPageSubtitle = useCallback((newSubtitle) => {
    setSubtitle(newSubtitle)
  }, [])

  const setPageInfo = useCallback((newTitle, newSubtitle, newIcon) => {
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