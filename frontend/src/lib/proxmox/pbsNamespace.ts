import { pbsFetch, type PbsClientOptions } from './pbs-client'

type NsRow = { ns: string }

function splitHeadTail(namespace: string): { head: string; parent: string | null } {
  const idx = namespace.lastIndexOf('/')

  if (idx < 0) return { head: namespace, parent: null }

return { head: namespace.slice(idx + 1), parent: namespace.slice(0, idx) }
}

/**
 * Create the namespace on PBS if missing. Hierarchical paths are created
 * level-by-level by the caller — this helper creates only ONE level.
 * Use `ensureNamespacePath` for full hierarchical creation.
 */
export async function ensureNamespace(
  conn: PbsClientOptions,
  datastore: string,
  namespace: string,
  opts: { parent?: string } = {},
): Promise<void> {
  const existing = await pbsFetch<NsRow[]>(conn, `/admin/datastore/${encodeURIComponent(datastore)}/namespace`)
  const already = (existing || []).some(r => r.ns === namespace)

  if (already) return

  const { head } = splitHeadTail(namespace)
  const body: Record<string, any> = { name: head }

  if (opts.parent) body.parent = opts.parent

  await pbsFetch(conn, `/admin/datastore/${encodeURIComponent(datastore)}/namespace`, {
    method: 'POST',
    body: body as any,
  })
}

/** Ensures every segment of a `a/b/c` namespace exists (idempotent). */
export async function ensureNamespacePath(
  conn: PbsClientOptions,
  datastore: string,
  fullNamespace: string,
): Promise<void> {
  const parts = fullNamespace.split('/').filter(Boolean)
  let parent: string | null = null

  for (const seg of parts) {
    const path = parent ? `${parent}/${seg}` : seg

    await ensureNamespace(conn, datastore, path, parent ? { parent } : {})
    parent = path
  }
}

export async function ensureSubToken(
  conn: PbsClientOptions,
  user: string,
  tokenId: string,
): Promise<{ tokenId: string; secret: string | null }> {
  const full = `${user}!${tokenId}`

  try {
    const existing = await pbsFetch<any>(
      conn,
      `/access/users/${user}/token/${tokenId}`,
    )

    if (existing && existing.tokenid) return { tokenId: full, secret: null }
  } catch {
    // fall through — create below
  }

  const created = await pbsFetch<any>(
    conn,
    `/access/users/${user}/token/${tokenId}`,
    { method: 'POST', body: {} as any },
  )


return { tokenId: created.tokenid ?? full, secret: created.value ?? null }
}

export async function setNamespaceAcl(
  conn: PbsClientOptions,
  datastore: string,
  namespace: string,
  authId: string,
  role: 'DatastoreBackup' | 'DatastoreReader' = 'DatastoreBackup',
): Promise<void> {
  await pbsFetch(conn, '/access/acl', {
    method: 'PUT',
    body: {
      path: `/datastore/${datastore}/${namespace}`,
      'auth-id': authId,
      role,
      propagate: true,
    } as any,
  })
}

/**
 * Grant DatastoreAudit on the datastore root (propagate=true). Required so
 * PVE's `pbs:` storage probe can confirm the datastore exists. Datastore.Audit
 * only allows seeing the datastore + namespace *names* — no data access — so
 * propagating it does not leak backup content between tenants.
 */
export async function setDatastoreAuditAcl(
  conn: PbsClientOptions,
  datastore: string,
  authId: string,
): Promise<void> {
  await pbsFetch(conn, '/access/acl', {
    method: 'PUT',
    body: {
      path: `/datastore/${datastore}`,
      'auth-id': authId,
      role: 'DatastoreAudit',
      propagate: true,
    } as any,
  })
}

/**
 * Wait until a freshly-minted sub-token + ACL combination is visible from the
 * sub-token's own POV. Polls `/admin/datastore/{store}/status` — the same call
 * PVE's `pbs:` storage probe ends up making. Empirically PBS takes ~3-5s to
 * propagate ACLs to where this endpoint succeeds; without this wait, PVE's
 * probe surfaces a misleading "Cannot find datastore" 500.
 */
export async function waitForPbsTokenReady(
  rootConn: PbsClientOptions,
  datastore: string,
  tokenId: string,
  secret: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const intervalMs = opts.intervalMs ?? 250

  const subConn: PbsClientOptions = {
    baseUrl: rootConn.baseUrl,
    apiToken: `${tokenId}:${secret}`,
    insecureDev: rootConn.insecureDev,
  }

  const deadline = Date.now() + timeoutMs
  let lastErr: any = null
  let attempts = 0
  const t0 = Date.now()

  while (Date.now() < deadline) {
    attempts++

    try {
      await pbsFetch(subConn, `/admin/datastore/${encodeURIComponent(datastore)}/status`)
      console.log(`[pbs-ready] sub-token ${tokenId} ready after ${Date.now() - t0}ms (${attempts} polls)`)

return
    } catch (e) {
      lastErr = e
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }

  throw new Error(
    `PBS sub-token ${tokenId} not ready on /admin/datastore/${datastore}/status after ${timeoutMs}ms (${attempts} polls): ${lastErr?.message ?? 'unknown'}`,
  )
}

export async function deleteSubToken(
  conn: PbsClientOptions,
  user: string,
  tokenId: string,
): Promise<void> {
  try {
    await pbsFetch(
      conn,
      `/access/users/${user}/token/${tokenId}`,
      { method: 'DELETE' },
    )
  } catch (e: any) {
    if (!/\b404\b/.test(String(e?.message))) throw e
  }
}

/** List snapshots in a specific namespace (non-recursive). */
export async function listSnapshotsInNamespace(
  conn: PbsClientOptions,
  datastore: string,
  namespace: string,
): Promise<any[]> {
  const qs = `?ns=${encodeURIComponent(namespace)}&max-depth=0`


return (await pbsFetch<any[]>(conn, `/admin/datastore/${encodeURIComponent(datastore)}/snapshots${qs}`)) || []
}
