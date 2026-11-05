/**
 * The orchestrator receives the cluster's SSH credentials for the run and must
 * neither store nor return them. This drops them again on the way out, so a
 * regression there, or a row stored by an older orchestrator, never reaches a
 * browser.
 */
export function publicRollingUpdate<T>(update: T): T {
  if (!update || typeof update !== "object") return update
  const u = update as Record<string, any>

  if (!u.config || typeof u.config !== "object") return update
  const { ssh_credentials: _creds, ...config } = u.config

  return { ...u, config } as T
}

/** The same, on any shape the orchestrator answers with: a run, a list, or either under `data`. */
export function publicRollingUpdates<T>(payload: T): T {
  if (Array.isArray(payload)) return payload.map(publicRollingUpdate) as T
  if (!payload || typeof payload !== "object") return payload
  const p = payload as Record<string, any>

  if ("data" in p) return { ...p, data: publicRollingUpdates(p.data) } as T

  return publicRollingUpdate(payload)
}
