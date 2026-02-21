/**
 * Pure URL utilities for extracting/replacing host information.
 * Used by connection failover and connected-node detection.
 */

/** Extract hostname or IP from a URL string */
export function extractHostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** Replace the host (hostname/IP) in a URL, keeping port and protocol */
export function replaceHostInUrl(url: string, newHost: string): string {
  const parsed = new URL(url)
  parsed.hostname = newHost
  return parsed.toString().replace(/\/$/, "")
}

/** Extract the port from a URL (returns the explicit port or a default) */
export function extractPortFromUrl(url: string, defaultPort = 8006): number {
  try {
    const parsed = new URL(url)
    return parsed.port ? parseInt(parsed.port, 10) : defaultPort
  } catch {
    return defaultPort
  }
}
