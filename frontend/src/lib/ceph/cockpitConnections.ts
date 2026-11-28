/*
   The connection lists of the Ceph page: the PVE connections flagged with
   Ceph (the cockpit) and those without (the deploy wizard, ui#1450), out of
   GET /api/v1/connections.
*/

export interface CephPageConnection {
  id: string
  name: string
}

export function toConnections(raw: unknown): CephPageConnection[] {
  if (!Array.isArray(raw)) return []

  return raw
    .filter((c): c is { id: unknown; name?: unknown } => c !== null && typeof c === 'object' && 'id' in c)
    .map(c => ({ id: String(c.id), name: typeof c.name === 'string' && c.name ? c.name : String(c.id) }))
}

/** The PVE connections not flagged with Ceph. */
export function toCandidates(raw: unknown): CephPageConnection[] {
  if (!Array.isArray(raw)) return []

  return toConnections(raw.filter(c => c !== null && typeof c === 'object' && (c as { hasCeph?: unknown }).hasCeph !== true))
}
