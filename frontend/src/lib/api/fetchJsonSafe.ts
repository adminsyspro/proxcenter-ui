/**
 * Fetch a JSON endpoint without ever letting `JSON.parse` leak its cryptic
 * `Unexpected token '<', "<html> <h"... is not valid JSON` message to the UI.
 *
 * A reverse proxy (nginx, Traefik, ...) sitting in front of ProxCenter returns
 * its OWN HTML error page on a gateway failure: a 502 Bad Gateway or a 504
 * Gateway Timeout body starts with a bare `<html><head>`, not with JSON. Code
 * that does `await res.json()` unconditionally then throws a `SyntaxError`
 * whose message ("Unexpected token '<'") ends up verbatim in an error banner.
 * That happened on the cluster Backups tab (discussion #396), where loading
 * backup jobs fans out into several sequential Proxmox calls and can outrun the
 * proxy's `proxy_read_timeout`.
 *
 * This helper reads the body as text first, parses it defensively, and returns
 * a flat result so callers can surface a clean `HTTP <status>` instead. It is
 * the same defensive shape used by {@link runBackupJobNow} (the #398 fix),
 * generalised so every fetch in the backup panel can share it.
 */
export interface JsonResult<T = unknown> {
  ok: boolean
  error?: string
  data?: T
}

export async function fetchJsonSafe<T = unknown>(
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonResult<T>> {
  const res = await fetchImpl(url, init)

  const text = await res.text()
  let body: { error?: string; data?: T } | undefined

  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      // Non-JSON body (an HTML error page from a reverse proxy, a 404/502/504).
      // Surface the status instead of the raw "Unexpected token '<'" parse error.
      return { ok: false, error: `HTTP ${res.status}` }
    }
  }

  if (!res.ok || body?.error) {
    return { ok: false, error: body?.error || `HTTP ${res.status}` }
  }

  return { ok: true, data: body?.data }
}
