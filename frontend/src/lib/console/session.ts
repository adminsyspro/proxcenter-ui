// frontend/src/lib/console/session.ts
//
// Short-lived in-memory store for console/terminal/SPICE session
// credentials. The browser only ever holds an opaque sessionId; the
// ws-proxy trades it (over the APP_SECRET-gated /api/internal/*/consume
// routes) for the underlying PVE parameters, which never reach the
// client. MVP store (one process); revisit with Redis if we ever run
// the proxy multi-instance.

const DEFAULT_TTL_MS = 30_000

type Entry = { data: any; expiresAt: number; multi: boolean }

const store = new Map<string, Entry>()

function makeId(): string {
  return crypto.randomUUID()
}

function isAlive(entry: Entry | undefined): entry is Entry {
  if (!entry) return false
  if (Date.now() > entry.expiresAt) {
    return false
  }
  return true
}

/** Store single-use credentials (VNC console, node shell, guest serial). */
export function putSingleUse(data: any, ttlMs: number = DEFAULT_TTL_MS): string {
  const id = makeId()
  store.set(id, { data, expiresAt: Date.now() + ttlMs, multi: false })
  return id
}

/** Single-use read: deletes the entry, returns null if missing/expired. */
export function takeSingleUse(id: string): any | null {
  const entry = store.get(id)
  if (!entry) return null
  store.delete(id)
  return isAlive(entry) ? entry.data : null
}

/**
 * Store multi-read credentials (SPICE). spice-html5 opens one WebSocket
 * per channel (main, display, inputs, cursor, ...), all needing the same
 * params, so the entry must survive repeated reads. TTL bounds its life;
 * the live TLS sockets are owned by ws-proxy and self-clean on close.
 */
export function putMultiUse(data: any, ttlMs: number = DEFAULT_TTL_MS): string {
  const id = makeId()
  store.set(id, { data, expiresAt: Date.now() + ttlMs, multi: true })
  return id
}

/** Multi-read: returns the data without deleting, null if missing/expired. */
export function readMultiUse(id: string): any | null {
  const entry = store.get(id)
  if (!isAlive(entry)) {
    if (entry) store.delete(id)
    return null
  }
  return entry.data
}
