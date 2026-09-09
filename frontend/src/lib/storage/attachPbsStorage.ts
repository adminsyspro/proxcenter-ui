import { createHash } from 'crypto'

import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { PBS_DEFAULT_PORT, resolvePbsMeta } from '@/lib/proxmox/pbsConnMeta'
import {
  deleteSubToken,
  ensureNamespacePath,
  ensureSubToken,
  setDatastoreAcl,
  setDatastoreAuditAcl,
  setNamespaceAcl,
  waitForPbsTokenReady,
} from '@/lib/proxmox/pbsNamespace'
import {
  createPbsStorage,
  deletePbsStorage,
  pbsStorageExists,
} from '@/lib/proxmox/pvePbsStorage'

/**
 * Attaching a Proxmox Backup Server datastore to a PVE cluster as a `pbs:`
 * storage, the gesture that otherwise sends the operator back to the Proxmox
 * web UI (issue #890).
 *
 * Only a PBS that is already a ProxCenter connection can be attached: we mint
 * a sub-token scoped to the datastore (and to the namespace when one is given)
 * and hand THAT to the cluster. The cluster never receives the admin token
 * stored on the connection, which any node root could read back from
 * `/etc/pve/priv/storage/<id>.pw`. Hand-typed credentials are deliberately not
 * accepted, so no screen and no API call can point a cluster at an
 * unknown host with a credential ProxCenter cannot revoke.
 *
 * The ACL / namespace / probe-retry sequence mirrors the vDC binding path
 * (`lib/vdc/pbsOrchestrator.ts`), which is where these workarounds were
 * measured against real PBS propagation delays.
 */

/** Prefix marking a PBS token as minted by ProxCenter for one PVE storage. */
export const PXC_TOKEN_PREFIX = 'pxc-'

/** PVE's own limit on a storage id, and what the UI field enforces. */
const STORAGE_NAME_MAX = 40

/** PBS refuses a namespace deeper than 8 levels. */
const NAMESPACE_MAX_DEPTH = 8

export class PbsAttachError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 400, code = 'invalid_request') {
    super(message)
    this.name = 'PbsAttachError'
    this.status = status
    this.code = code
  }
}

export interface AttachPbsStorageArgs {
  pveConn: PveConn
  storage: string
  datastore: string
  /** Empty or absent attaches the datastore root. */
  namespace?: string | null
  /** Empty means every node of the cluster, PVE's own default. */
  nodes?: string[]
  /** Id of the PBS connection whose datastore is attached. */
  pbsConnectionId: string
}

export interface AttachPbsStorageResult {
  storage: string
  server: string
  datastore: string
  namespace: string
  nodes: string[]
  /** Whose credential the cluster ended up holding. */
  credentials: 'scoped-token'
  tokenId: string
  steps: {
    namespace: 'created' | 'skipped'
    token: 'created' | 'rotated'
    acl: 'ok'
  }
}

/** PVE storage ids: a letter first, then letters, digits, dot, dash or underscore. */
export function normalizeStorageName(raw: unknown): string {
  const name = String(raw ?? '').trim()

  if (!name) throw new PbsAttachError('Storage name is required', 400, 'storage_required')

  if (name.length > STORAGE_NAME_MAX) {
    throw new PbsAttachError(
      `Storage name must be at most ${STORAGE_NAME_MAX} characters`,
      400,
      'storage_too_long',
    )
  }

  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(name)) {
    throw new PbsAttachError(
      'Storage name must start with a letter and hold only letters, digits, dots, dashes or underscores',
      400,
      'storage_invalid',
    )
  }

  return name
}

/**
 * Trims one repeated character off both ends, in linear time.
 *
 * The obvious `/^x+|x+$/` form backtracks polynomially on a long run of that
 * character, and these values come from a request body (CodeQL
 * js/polynomial-redos).
 */
function trimChar(value: string, char: string): string {
  let start = 0
  let end = value.length

  while (start < end && value[start] === char) start++
  while (end > start && value[end - 1] === char) end--

  return value.slice(start, end)
}

/** PBS namespaces: `a/b/c`, each level alphanumeric with dash or underscore. */
export function normalizeNamespace(raw: unknown): string {
  const ns = trimChar(String(raw ?? '').trim(), '/')

  if (!ns) return ''

  const parts = ns.split('/')

  if (parts.length > NAMESPACE_MAX_DEPTH) {
    throw new PbsAttachError(
      `Namespace must be at most ${NAMESPACE_MAX_DEPTH} levels deep`,
      400,
      'namespace_too_deep',
    )
  }

  if (!parts.every(p => /^[a-zA-Z0-9_-]+$/.test(p))) {
    throw new PbsAttachError(
      'Namespace levels may hold only letters, digits, dashes and underscores',
      400,
      'namespace_invalid',
    )
  }

  return parts.join('/')
}

/**
 * Token id for one (cluster, storage) pair, e.g. `pxc-prod-pbs-main-a1b2c3`.
 *
 * The cluster name makes it readable in the PBS token list, and the hash of
 * the connection id keeps two identically named clusters from sharing a
 * token: re-minting a shared one would rotate the secret under the other
 * cluster and break its backups. Deterministic, so re-attaching the same
 * pair reclaims the same token instead of piling up new ones.
 */
export function buildScopedTokenId(args: {
  pveConnectionId: string
  pveConnName?: string | null
  storage: string
}): string {
  const slug = (s: string, max: number) =>
    trimChar(s.toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-').slice(0, max)

  const cluster = slug(String(args.pveConnName ?? ''), 16)
  const storage = slug(args.storage, 20)
  const hash = createHash('sha256').update(args.pveConnectionId).digest('hex').slice(0, 6)

  return [PXC_TOKEN_PREFIX.replace(/-$/, ''), cluster, storage, hash].filter(Boolean).join('-')
}

/** Whether a `pbs:` storage holds a token this code minted. */
export function isProxCenterToken(username: unknown): boolean {
  const m = String(username ?? '').match(/!([^!]+)$/)

  return !!m && m[1].startsWith(PXC_TOKEN_PREFIX)
}

export async function attachPbsStorage(args: AttachPbsStorageArgs): Promise<AttachPbsStorageResult> {
  const storage = normalizeStorageName(args.storage)
  const namespace = normalizeNamespace(args.namespace)
  const nodes = (args.nodes ?? []).map(n => String(n).trim()).filter(Boolean)
  const datastore = String(args.datastore ?? '').trim()

  if (!datastore) throw new PbsAttachError('Datastore is required', 400, 'datastore_required')

  if (!args.pbsConnectionId) {
    throw new PbsAttachError('A registered backup server is required', 400, 'pbs_connection_required')
  }

  // Never touch the PBS before the name is known to be free. Minting a token
  // for a storage PVE will refuse leaves a credential behind for nothing, and
  // reclaiming the token of an existing storage would rotate the secret it
  // runs its backups with.
  if (await pbsStorageExists(args.pveConn, storage)) {
    throw new PbsAttachError(
      `A storage named "${storage}" already exists on this cluster`,
      409,
      'storage_exists',
    )
  }

  const meta = await resolvePbsMeta(args.pbsConnectionId)
  const tokenShortId = buildScopedTokenId({
    pveConnectionId: args.pveConn.id,
    pveConnName: args.pveConn.name,
    storage,
  })

  if (namespace) await ensureNamespacePath(meta.conn, datastore, namespace)

  let token = await ensureSubToken(meta.conn, meta.rootUser, tokenShortId)
  let tokenStep: 'created' | 'rotated' = 'created'

  if (!token.secret) {
    // PBS hands a token secret out once, at creation. This token id belongs to
    // this (cluster, storage) pair alone and the storage does not exist yet,
    // so no backup runs through it: reclaim it by re-minting.
    await deleteSubToken(meta.conn, meta.rootUser, tokenShortId)
    token = await ensureSubToken(meta.conn, meta.rootUser, tokenShortId)
    tokenStep = 'rotated'
  }

  if (!token.secret) {
    throw new PbsAttachError('PBS returned no secret for the storage token', 502, 'token_secret_missing')
  }

  try {
    // PVE probes the storage with `proxmox-backup-client status`, which needs
    // the datastore itself to be visible and not only the namespace inside
    // it. Datastore.Audit exposes datastore and namespace NAMES only, no
    // backup content.
    await setDatastoreAuditAcl(meta.conn, datastore, token.tokenId)

    if (namespace) {
      await setNamespaceAcl(meta.conn, datastore, namespace, token.tokenId, 'DatastoreBackup')
    } else {
      await setDatastoreAcl(meta.conn, datastore, token.tokenId, 'DatastoreBackup')
    }

    // PBS takes seconds to propagate a fresh token + ACL to where its own
    // status endpoint answers. Without this wait PVE's probe fails with a
    // misleading "Cannot find datastore".
    await waitForPbsTokenReady(meta.conn, datastore, token.tokenId, token.secret)

    await createPbsStorage(args.pveConn, {
      storage,
      server: meta.host,
      datastore,
      namespace,
      username: token.tokenId,
      password: token.secret,
      fingerprint: meta.fingerprint,
      nodes,
      ...(meta.port !== PBS_DEFAULT_PORT ? { port: meta.port } : {}),
    })
  } catch (e) {
    // A token no storage uses is a credential left on the PBS for nothing.
    // Best-effort: a failed cleanup must not mask the error that caused it.
    try {
      await deleteSubToken(meta.conn, meta.rootUser, tokenShortId)
    } catch (cleanupError: any) {
      console.warn(`[pbs-attach] token cleanup failed for ${tokenShortId}: ${cleanupError?.message ?? cleanupError}`)
    }

    throw e
  }

  return {
    storage,
    server: meta.host,
    datastore,
    namespace,
    nodes,
    credentials: 'scoped-token',
    tokenId: token.tokenId,
    steps: { namespace: namespace ? 'created' : 'skipped', token: tokenStep, acl: 'ok' },
  }
}

export interface DetachPbsStorageArgs {
  pveConn: PveConn
  storage: string
  /**
   * Other PVE connections to check before revoking the token: the same PBS
   * token can back a storage on a second cluster, and revoking it there would
   * break backups the operator did not ask about.
   */
  siblingConns?: PveConn[]
  /**
   * Clusters the caller could not even resolve into a client (no credential,
   * a denied row, a decrypt failure). They are counted as users of the token,
   * for the same reason an unreachable cluster is: what cannot be cleared
   * cannot be declared free.
   */
  unverifiableConns?: string[]
  /** PBS connections ProxCenter knows, matched by host to find the token owner. */
  pbsConnectionIds?: string[]
}

export interface DetachPbsStorageResult {
  storage: string
  /** What happened to the scoped token, and why when nothing did. */
  token: 'revoked' | 'kept-in-use' | 'kept-unmanaged' | 'kept-unknown-pbs' | 'revoke-failed'
  tokenId?: string
  usedBy?: string[]
}

type PveStorageConfig = {
  storage?: string
  type?: string
  server?: string
  datastore?: string
  username?: string
}

/** Reads one storage entry from `storage.cfg`, or null when it is gone. */
async function readStorageConfig(conn: PveConn, storage: string): Promise<PveStorageConfig | null> {
  try {
    return await pveFetch<PveStorageConfig>(conn, `/storage/${encodeURIComponent(storage)}`)
  } catch (e: any) {
    const msg = String(e?.message ?? '')

    if (/\b404\b/.test(msg) || /does not exist/i.test(msg)) return null
    throw e
  }
}

export async function detachPbsStorage(args: DetachPbsStorageArgs): Promise<DetachPbsStorageResult> {
  const storage = normalizeStorageName(args.storage)
  const cfg = await readStorageConfig(args.pveConn, storage)

  if (!cfg) throw new PbsAttachError(`Storage "${storage}" does not exist on this cluster`, 404, 'storage_not_found')

  if (cfg.type !== 'pbs') {
    throw new PbsAttachError(
      `Storage "${storage}" is of type ${cfg.type ?? 'unknown'}; only PBS storages can be detached here`,
      400,
      'storage_not_pbs',
    )
  }

  const username = String(cfg.username ?? '')
  const server = String(cfg.server ?? '')

  await deletePbsStorage(args.pveConn, storage)

  if (!isProxCenterToken(username)) {
    return { storage, token: 'kept-unmanaged' }
  }

  // Same token on another cluster: the storage entries are independent, the
  // credential is not.
  const usedBy: string[] = []

  for (const sibling of args.siblingConns ?? []) {
    if (sibling.id === args.pveConn.id) continue

    try {
      const rows = await pveFetch<PveStorageConfig[]>(sibling, '/storage')

      if ((rows || []).some(r => r?.type === 'pbs' && String(r.username ?? '') === username)) {
        usedBy.push(sibling.name)
      }
    } catch (e: any) {
      // An unreachable cluster cannot be cleared, so treat it as a user: a
      // stale token is recoverable, a revoked one in use is an outage.
      console.warn(`[pbs-attach] cannot check ${sibling.name} for token reuse: ${e?.message ?? e}`)
      usedBy.push(sibling.name)
    }
  }

  usedBy.push(...(args.unverifiableConns ?? []))

  if (usedBy.length) return { storage, token: 'kept-in-use', tokenId: username, usedBy }

  const owner = await findPbsConnectionForHost(args.pbsConnectionIds ?? [], server)

  if (!owner) return { storage, token: 'kept-unknown-pbs', tokenId: username }

  const shortId = username.slice(username.indexOf('!') + 1)

  try {
    await deleteSubToken(owner.conn, owner.rootUser, shortId)

    return { storage, token: 'revoked', tokenId: username }
  } catch (e: any) {
    console.warn(`[pbs-attach] token revocation failed for ${username}: ${e?.message ?? e}`)

    return { storage, token: 'revoke-failed', tokenId: username }
  }
}

/** Finds which registered PBS answers on the host a `pbs:` storage points at. */
async function findPbsConnectionForHost(
  pbsConnectionIds: string[],
  server: string,
): Promise<{ conn: { baseUrl: string; apiToken: string; insecureDev: boolean }; rootUser: string } | null> {
  const host = server.trim().toLowerCase()

  if (!host) return null

  for (const id of pbsConnectionIds) {
    try {
      const meta = await resolvePbsMeta(id)

      if (meta.host.toLowerCase() === host) return { conn: meta.conn, rootUser: meta.rootUser }
    } catch {
      // A PBS row without a fingerprint or with an unexpected token format
      // cannot own a storage we created, so it is not a candidate.
    }
  }

  return null
}
