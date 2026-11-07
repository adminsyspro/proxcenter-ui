// src/lib/guestFileRestore/pbsPveStorages.ts
//
// Pure matching of PVE storage configs (`GET /storage`) against a PBS
// server, datastore and namespace. The storage ID plays no part: an operator
// names a `pbs` storage as they like. Used by every route that joins a PBS
// connection to the PVE storages that reach it.

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

/** A SHA-256 certificate fingerprint as 64 upper-case hex digits, or '' when it is not one. */
export function normalizeFingerprint(value: unknown): string {
  if (typeof value !== 'string') return ''
  const hex = value.replace(/[^0-9a-f]/gi, '').toUpperCase()
  return hex.length === 64 ? hex : ''
}

/** How ProxCenter knows a PBS server: the host of its connection and the certificate it pinned. */
export interface PbsServerIdentity {
  host: string
  fingerprint?: string | null
}

export function pbsIdentityOf(conn: { baseUrl: string; fingerprint?: string | null }): PbsServerIdentity {
  return { host: pbsHostOf(conn.baseUrl), fingerprint: conn.fingerprint ?? null }
}

/**
 * Whether a PVE `pbs` storage config reaches this PBS server. The `server`
 * field is compared as written, so a storage declared by FQDN never equals a
 * connection declared by IP (or the reverse); the certificate fingerprint both
 * sides pin then identifies the server whatever address each one uses.
 */
export function samePbsServer(
  storage: { server?: unknown; fingerprint?: unknown },
  identity: PbsServerIdentity,
): boolean {
  if (sameServer(storage.server, identity.host)) return true
  const pinned = normalizeFingerprint(identity.fingerprint)
  return pinned !== '' && normalizeFingerprint(storage.fingerprint) === pinned
}

export function matchingPbsStorages(
  storages: unknown,
  match: PbsServerIdentity & { datastore: string; namespace: string },
): Array<{ storage: string; nodes: string[] }> {
  if (!Array.isArray(storages)) return []
  return storages
    .filter(
      (s: any) =>
        s?.type === 'pbs' &&
        samePbsServer(s, match) &&
        s.datastore === match.datastore &&
        String(s.namespace ?? '') === match.namespace,
    )
    .map((s: any) => ({
      storage: String(s.storage),
      nodes: typeof s.nodes === 'string' ? s.nodes.split(',').map((n: string) => n.trim()).filter(Boolean) : [],
    }))
}
