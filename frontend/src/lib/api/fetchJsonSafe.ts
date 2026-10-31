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
  const { ok, error, data } = await fetchJsonResult<T>(url, init, fetchImpl)

  return ok ? { ok, data } : { ok, error }
}

/** {@link JsonResult} plus the HTTP status and the whole parsed body. */
export interface JsonResponseResult<T = unknown> extends JsonResult<T> {
  status: number
  body?: unknown
}

/**
 * The message a failed API call should show: the body's `error` (a string,
 * or an object carrying `message`), else its `message`, else `HTTP <status>`.
 */
function errorMessageOf(body: unknown, status: number): string {
  const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; message?: unknown }
  if (typeof b.error === 'string' && b.error) return b.error
  const nested = (b.error && typeof b.error === 'object' ? (b.error as { message?: unknown }).message : undefined)
  if (typeof nested === 'string' && nested) return nested
  if (typeof b.message === 'string' && b.message) return b.message

  return `HTTP ${status}`
}

/**
 * Same defensive read as {@link fetchJsonSafe}, keeping the HTTP status (a
 * caller can tell a definitive 4xx from a transient 5xx) and the whole body
 * (endpoints that do not wrap their payload in `data`).
 */
export async function fetchJsonResult<T = unknown>(
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<JsonResponseResult<T>> {
  const res = await fetchImpl(url, init)
  const status = res.status

  const text = await res.text()
  let body: { error?: unknown; data?: T } | undefined

  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      // Non-JSON body (an HTML error page from a reverse proxy, a 404/502/504).
      // Surface the status instead of the raw "Unexpected token '<'" parse error.
      return { ok: false, error: `HTTP ${status}`, status }
    }
  }

  if (!res.ok || body?.error) {
    return { ok: false, error: errorMessageOf(body, status), status, body }
  }

  return { ok: true, data: body?.data, status, body }
}

/** A rejected API call: its message is ready to show, its status is kept. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * For mutation handlers: performs the request and resolves with the parsed
 * body only when the server accepted it, else throws an {@link ApiError}. A
 * raw `await fetch()` resolves on a 4xx/5xx too, which is how rejected
 * mutations used to be reported as successes.
 */
export async function requireOk<B = unknown>(
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<B | undefined> {
  const result = await fetchJsonResult(url, init, fetchImpl)

  if (!result.ok) throw new ApiError(result.error || `HTTP ${result.status}`, result.status)

  return result.body as B | undefined
}

/** JSON request init for {@link requireOk}. */
export function jsonInit(method: string, payload?: unknown): RequestInit {
  return payload === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
}

/** Outcome of a set of independent mutations run together. */
export interface SettledCounts {
  succeeded: number
  failed: number
  /** First failure message, to show next to the counts. */
  firstError?: string
}

/**
 * Runs every call, never short-circuiting on a failure, and counts the
 * outcomes. A `Promise.all` over raw fetches both hides the HTTP errors and
 * stops reporting at the first network exception.
 */
export async function settleCounts(calls: Array<() => Promise<unknown>>): Promise<SettledCounts> {
  const results = await Promise.allSettled(calls.map(call => call()))
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  const firstError = rejected[0]?.reason

  return {
    succeeded: results.length - rejected.length,
    failed: rejected.length,
    ...(firstError === undefined ? {} : { firstError: firstError instanceof Error ? firstError.message : String(firstError) }),
  }
}
