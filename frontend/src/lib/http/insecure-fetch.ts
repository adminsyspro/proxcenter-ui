/**
 * Shared HTTP helper for migration-source pipelines that need:
 *   1. Accept-Encoding: identity to defeat brotli/zstd handling regressions
 *      seen on Node 26 + undici 8.x when a custom dispatcher is passed to
 *      WHATWG fetch().
 *   2. Optional self-signed TLS bypass via an undici Agent.
 *
 * Background: v1.4.1 fixed two compounding Node 26 / undici 8.x regressions
 * on the vCenter SOAP path (brotli skipped, headers swallowed). The same
 * `fetch + dispatcher` pattern existed in XCP-ng / Hyper-V / Nutanix clients;
 * this helper centralises the defensive headers so the pattern is enforced
 * once instead of duplicated per call site.
 */

export const INSECURE_FETCH_HEADERS = {
  "Accept-Encoding": "identity",
} as const

export async function makeInsecureDispatcher(): Promise<unknown> {
  const { Agent } = await import("undici")
  return new Agent({ connect: { rejectUnauthorized: false } })
}

export type InsecureFetchInit = RequestInit & {
  insecureTLS?: boolean
  dispatcher?: unknown
}

export async function fetchWithInsecureTLS(
  url: string,
  opts: InsecureFetchInit = {}
): Promise<Response> {
  const { insecureTLS, headers, dispatcher, ...rest } = opts

  const finalOpts: InsecureFetchInit = {
    ...rest,
    headers: { ...INSECURE_FETCH_HEADERS, ...headers },
  }

  if (dispatcher) {
    finalOpts.dispatcher = dispatcher
  } else if (insecureTLS) {
    finalOpts.dispatcher = await makeInsecureDispatcher()
  }

  return fetch(url, finalOpts as RequestInit)
}
