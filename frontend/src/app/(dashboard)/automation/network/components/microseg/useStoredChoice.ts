import { useCallback, useState } from 'react'

/**
 * A value kept in this browser under `key`: read once (a missing, unreadable or refused storage gives what `decode`
 * makes of null), written on every change (a refused storage keeps the choice for the life of the page).
 */
export function useStored<T>(key: string, decode: (raw: string | null) => T, encode: (value: T) => string): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return decode(window.localStorage.getItem(key))
    } catch {
      return decode(null)
    }
  })
  const change = useCallback((next: T) => {
    setValue(next)
    try {
      window.localStorage.setItem(key, encode(next))
    } catch {
      // Storage refused: the choice lasts as long as the page.
    }
  }, [key, encode])
  return [value, change]
}

const asIs = (value: string) => value

/** One of `allowed` kept in this browser; anything else stored (or nothing) means `fallback`. */
export function useStoredChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const decode = useCallback((raw: string | null) => allowed.find(v => v === raw) ?? fallback, [allowed, fallback])
  return useStored<T>(key, decode, asIs)
}
