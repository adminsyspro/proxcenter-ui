import { useEffect, useState } from 'react'
import { useSettings } from '@core/hooks/useSettings'

/**
 * Returns a SWR-compatible refreshInterval (ms) based on the global setting.
 * Pauses polling when the browser tab is hidden (visibility API).
 *
 * @param baseMs - The hook's original hardcoded interval in milliseconds.
 *                 If provided, the returned value scales proportionally:
 *                 `baseMs * (globalSeconds / 30)` so faster hooks stay faster.
 *                 If omitted, returns `globalSeconds * 1000`.
 * @returns 0 when refresh is disabled or tab is hidden, otherwise the computed interval in ms.
 */
export function useRefreshInterval(baseMs?: number): number {
  const { settings } = useSettings()
  const globalSeconds: number = settings.refreshInterval ?? 30
  const [visible, setVisible] = useState(
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  )

  useEffect(() => {
    const handler = () => setVisible(document.visibilityState === 'visible')

    document.addEventListener('visibilitychange', handler)

    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  if (globalSeconds === 0 || !visible) return 0

  if (baseMs != null) {
    return Math.round(baseMs * (globalSeconds / 30))
  }

  return globalSeconds * 1000
}
