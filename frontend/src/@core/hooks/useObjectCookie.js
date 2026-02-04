// React Imports
import { useMemo } from 'react'

// Third-party Imports
import { useCookie } from 'react-use'

export const useObjectCookie = (key, fallback) => {
  // Hooks
  const [valStr, updateCookie] = useCookie(key)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => (valStr ? JSON.parse(valStr) : fallback), [valStr])

  const updateValue = newVal => {
    // Set cookie with 1 year expiration for persistent settings
    const expires = new Date()

    expires.setFullYear(expires.getFullYear() + 1)
    updateCookie(JSON.stringify(newVal), { expires, path: '/' })
  }

  return [value, updateValue]
}
