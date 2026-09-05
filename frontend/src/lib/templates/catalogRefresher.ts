/**
 * Daily refresh of the remote cloud image catalog.
 *
 * Timer discipline copied from lib/auth/sessionSweeper.ts: an in-flight guard
 * so a slow fetch cannot overlap the next tick, unref() so the timers never
 * keep the process alive by themselves, and an error path that can never
 * throw. Safe on every HA replica: refreshRemoteCatalog ends in an idempotent
 * upsert, so concurrent runs only cost a redundant HTTP request per day.
 */
import { refreshRemoteCatalog, type RefreshOutcome } from './catalogStore'

export const CATALOG_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
export const CATALOG_REFRESH_INITIAL_DELAY_MS = 30_000

export interface CatalogRefresherOptions {
  intervalMs?: number
  initialDelayMs?: number
  refresh?: () => Promise<RefreshOutcome>
}

function unref(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) {
  if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
}

/**
 * Start the catalog refresher: one run after `initialDelayMs` (the server has
 * just booted, let the database and the network settle), then one per
 * `intervalMs`.
 *
 * @returns A stop() function, safe to call multiple times.
 */
export function startCatalogRefresher(options: CatalogRefresherOptions = {}): () => void {
  const {
    intervalMs = CATALOG_REFRESH_INTERVAL_MS,
    initialDelayMs = CATALOG_REFRESH_INITIAL_DELAY_MS,
    refresh = () => refreshRemoteCatalog(),
  } = options
  let stopped = false
  let inFlight = false
  let interval: ReturnType<typeof setInterval> | null = null

  const tick = () => {
    if (stopped || inFlight) return
    inFlight = true
    refresh()
      .then(
        (outcome) => {
          if (outcome.result === 'updated') {
            console.log(`[catalog] remote image catalog updated: +${outcome.added.length} ~${outcome.updated.length} -${outcome.removed.length}`)
          } else if (outcome.result === 'error') {
            console.error(`[catalog] remote image catalog refresh failed (non-fatal): ${outcome.error}`)
          }
          // 'unchanged' every day for the life of the deployment is noise.
        },
        (err) => {
          console.error('[catalog] remote image catalog refresh threw (non-fatal):', err)
        },
      )
      .finally(() => { inFlight = false })
  }

  const initial = setTimeout(() => {
    if (stopped) return
    tick()
    interval = setInterval(tick, intervalMs)
    unref(interval)
  }, initialDelayMs)
  unref(initial)

  return function stop() {
    if (stopped) return
    stopped = true
    clearTimeout(initial)
    if (interval) clearInterval(interval)
  }
}
