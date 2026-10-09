// src/lib/guestFileRestore/pbsPveStorages.ts
//
// Pure matching of PVE storage configs (`GET /storage`) against a PBS
// server, datastore and namespace. Used by the pbs/[id]/pve-storages route.

export interface PbsPveStorage {
  connId: string
  connName: string
  storage: string
  /** Nodes the storage is restricted to; empty = every node of the cluster. */
  nodes: string[]
}

export function pbsHostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return baseUrl.toLowerCase()
  }
}

/** Storage config `server` vs the PBS connection host, both as written (no DNS). */
export function sameServer(configured: unknown, host: string): boolean {
  if (typeof configured !== 'string') return false
  return configured.trim().replace(/^\[|\]$/g, '').toLowerCase() === host
}

export function matchingPbsStorages(
  storages: unknown,
  match: { host: string; datastore: string; namespace: string },
): Array<{ storage: string; nodes: string[] }> {
  if (!Array.isArray(storages)) return []
  return storages
    .filter(
      (s: any) =>
        s?.type === 'pbs' &&
        sameServer(s.server, match.host) &&
        s.datastore === match.datastore &&
        String(s.namespace ?? '') === match.namespace,
    )
    .map((s: any) => ({
      storage: String(s.storage),
      nodes: typeof s.nodes === 'string' ? s.nodes.split(',').map((n: string) => n.trim()).filter(Boolean) : [],
    }))
}
