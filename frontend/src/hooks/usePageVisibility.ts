import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  document.addEventListener('visibilitychange', cb)
  return () => document.removeEventListener('visibilitychange', cb)
}

function getSnapshot() {
  return document.visibilityState === 'visible'
}

function getServerSnapshot() {
  return true
}

/** Returns `true` when the current tab is visible. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Like `setInterval`, but pauses when the page is hidden and resumes immediately when visible.
 * Returns nothing; cleanup is automatic.
 */
export function useVisibleInterval(callback: () => void, delayMs: number) {
  const savedCallback = useRef(callback)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null

    function start() {
      if (id !== null) return
      savedCallback.current()
      id = setInterval(() => savedCallback.current(), delayMs)
    }

    function stop() {
      if (id !== null) {
        clearInterval(id)
        id = null
      }
    }

    function onVisChange() {
      if (document.visibilityState === 'visible') {
        start()
      } else {
        stop()
      }
    }

    document.addEventListener('visibilitychange', onVisChange)

    if (document.visibilityState === 'visible') {
      start()
    }

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [delayMs])
}
