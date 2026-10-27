// React Imports
import { useMemo } from 'react'

// Third-party Imports
import { useCookie } from 'react-use'

export const useObjectCookie = <T>(key: string, fallback: T): [T, (newVal: T) => void] => {
  // Hooks
  const [valStr, updateCookie] = useCookie(key)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo<T>(() => (valStr ? (JSON.parse(valStr) as T) : fallback), [valStr])

  const updateValue = (newVal: T) => {
    // Set cookie with 1 year expiration for persistent settings
    const expires = new Date()

    expires.setFullYear(expires.getFullYear() + 1)
    updateCookie(JSON.stringify(newVal), { expires, path: '/' })
  }

  return [value, updateValue]
}
