/**
 * Dependency-injected SOAP session keepalive ticker (issue #394).
 *
 * The warm pipeline holds ONE SOAP session for the entire migration, which can
 * span hours on large disks. vCenter/ESXi reap idle SOAP sessions (~30 min
 * default). This ticker calls a caller-supplied ping() every intervalMs so the
 * server's idle timer is reset. Using a DI ping callback keeps this module
 * free of soap/cbt imports and fully unit-testable with fake timers.
 */

/**
 * Start a periodic keepalive ticker.
 *
 * @param ping       Async function to call each tick (e.g. () => soapKeepAlive(session)).
 * @param intervalMs Interval between pings in milliseconds.
 * @returns          A stop() function that cancels the ticker. Safe to call multiple times.
 */
export function startSoapKeepAlive(ping: () => Promise<void>, intervalMs: number): () => void {
  let inFlight = false
  let stopped = false

  const timer = setInterval(() => {
    if (stopped || inFlight) return
    inFlight = true
    ping().catch(() => {}).finally(() => { inFlight = false })
  }, intervalMs)

  // Do not keep the Node process alive just for a keepalive timer.
  if (typeof (timer as any).unref === "function") (timer as any).unref()

  return function stop() {
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }
}
