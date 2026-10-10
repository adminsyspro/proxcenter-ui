// JSON fetch shared by the delivery destination cards (syslog collectors,
// notification channels): a non-2xx answer throws with the route's own
// `error` message, falling back to the raw body, then to the HTTP status.
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const text = await r.text()
  let json: any = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // not JSON
  }

  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`)

  return json as T
}
