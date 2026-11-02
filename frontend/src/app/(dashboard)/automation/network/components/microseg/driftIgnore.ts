import { useCallback, useState } from 'react'

const storageKey = (connectionId: string) => `microseg.ignoredDrifts.${connectionId}`

function read(connectionId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(connectionId)) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function write(connectionId: string, keys: Set<string>) {
  try {
    window.localStorage.setItem(storageKey(connectionId), JSON.stringify([...keys]))
  } catch {
    // Private window or blocked storage: the drift is hidden until the page is left.
  }
}

/**
 * The drifts the admin chose to ignore on this connection, kept in the browser
 * (a convenience, not shared: another browser still shows them).
 */
export function useIgnoredDrifts(connectionId: string) {
  const [ignored, setIgnored] = useState<Set<string>>(() => read(connectionId))

  const update = useCallback((change: (keys: Set<string>) => void) => {
    const next = new Set(ignored)
    change(next)
    write(connectionId, next)
    setIgnored(next)
  }, [connectionId, ignored])

  const ignore = useCallback((key: string) => update(keys => keys.add(key)), [update])
  const restore = useCallback((key: string) => update(keys => keys.delete(key)), [update])
  return { ignored, ignore, restore }
}
