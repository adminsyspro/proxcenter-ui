import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { detachPbsStorage, PbsAttachError } from "@/lib/storage/attachPbsStorage"
import {
  buildStorageParams,
  ClusterStorageError,
  pveMessage,
  redactSecrets,
  scrubStorageConfig,
  storageUsage,
} from "@/lib/storage/clusterStorage"
import { isClusterStorageType, STORAGE_ID_RE } from "@/lib/storage/clusterStorageTypes"
import { pveFetch, PveApplicationError } from "@/lib/proxmox/client"
import { licenseExcludedResponse } from "@/lib/api/response"
import { audit } from "@/lib/audit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; storage: string }> | { id: string; storage: string } }

/**
 * Shared preamble: connection.manage on the cluster, a caller who owns it (a
 * vDC tenant never edits storage.cfg), a well-formed storage id.
 */
async function resolveStorageWrite(ctx: Ctx, verb: string): Promise<{ error: Response } | { id: string; storage: string }> {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  const storage = (params as any)?.storage

  if (!id || !storage) return { error: NextResponse.json({ error: "Missing params" }, { status: 400 }) }

  const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

  if (denied) return { error: denied }

  if (maskingScope(await getTenantInfrastructureScope(await getCurrentTenantId()))) {
    return { error: NextResponse.json({ error: `${verb} a storage is reserved to the owner of the cluster` }, { status: 403 }) }
  }

  if (!STORAGE_ID_RE.test(String(storage))) return { error: NextResponse.json({ error: "Invalid storage id" }, { status: 400 }) }

  return { id: String(id), storage: String(storage) }
}

function pveErrorResponse(e: any, secrets: Array<string | undefined> = []) {
  const excluded = licenseExcludedResponse(e)
  if (excluded) return excluded
  const message = redactSecrets(e instanceof PveApplicationError ? pveMessage(e) : e?.message || String(e), secrets)
  const status = e instanceof PveApplicationError && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500

  return NextResponse.json({ error: message }, { status })
}

/**
 * GET /api/v1/connections/[id]/storage/[storage]
 *
 * The storage's configuration for the edit dialog (roadmap#202), secrets left
 * out: a password or keyring is written, never read back.
 */
async function getHandler(_req: Request, ctx: Ctx): Promise<Response> {
  const r = await resolveStorageWrite(ctx, "Editing")

  if ("error" in r) return r.error

  try {
    const conn = await getConnectionById(r.id)
    const cfg = await pveFetch<Record<string, unknown>>(conn, `/storage/${encodeURIComponent(r.storage)}`)

    return NextResponse.json({ data: scrubStorageConfig(cfg || {}) })
  } catch (e: any) {
    return pveErrorResponse(e)
  }
}

/**
 * PUT /api/v1/connections/[id]/storage/[storage]
 *
 * Changes what Proxmox lets change on a storage: contents, nodes, enabled,
 * bandwidth limits, and the type's editable fields. A blank secret keeps the
 * stored one. Bound to the config digest read first, so a concurrent edit
 * made in Proxmox is not overwritten.
 */
async function putHandler(req: Request, ctx: Ctx): Promise<Response> {
  const r = await resolveStorageWrite(ctx, "Editing")

  if ("error" in r) return r.error

  const body = await req.json().catch(() => null)

  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

  const secrets = [body?.fields?.password, body?.fields?.keyring].map(v => (typeof v === "string" ? v : undefined))

  try {
    const conn = await getConnectionById(r.id)
    const cfg = await pveFetch<Record<string, any>>(conn, `/storage/${encodeURIComponent(r.storage)}`)

    if (!isClusterStorageType(cfg?.type)) {
      return NextResponse.json({ error: "This storage type is not edited from here" }, { status: 400 })
    }

    const built = buildStorageParams({ ...body, type: cfg.type }, "update")
    const form = new URLSearchParams(built.params)
    const deletes = built.deletes.filter(k => cfg[k] !== undefined)

    if (deletes.length) form.set("delete", deletes.join(","))
    if (cfg.digest) form.set("digest", String(cfg.digest))

    await pveFetch<any>(conn, `/storage/${encodeURIComponent(r.storage)}`, { method: "PUT", body: form })

    await audit({
      action: "update",
      category: "storage",
      resourceType: "storage",
      resourceId: r.storage,
      resourceName: r.storage,
      status: "success",
      details: { connectionId: r.id, connectionName: conn.name, type: cfg.type, ...scrubStorageConfig(built.params), cleared: deletes },
    })

    return NextResponse.json({ data: { storage: r.storage, type: cfg.type } })
  } catch (e: any) {
    if (e instanceof ClusterStorageError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })

    const res = pveErrorResponse(e, secrets)

    await audit({
      action: "update",
      category: "storage",
      resourceType: "storage",
      resourceId: r.storage,
      resourceName: r.storage,
      status: "failure",
      errorMessage: redactSecrets(e instanceof PveApplicationError ? pveMessage(e) : e?.message || String(e), secrets),
      details: { connectionId: r.id },
    })

    return res
  }
}

/**
 * The generic removal when the storage is not a PBS one, or null to let the
 * PBS detach run. An unreadable config leaves the PBS path as it was: it
 * reports its own errors.
 */
async function removeIfNotPbs(req: Request, id: string, storage: string, conn: any): Promise<Response | null> {
  const cfg = await pveFetch<Record<string, any>>(conn, `/storage/${encodeURIComponent(storage)}`).catch(() => null)

  if (!cfg?.type || cfg.type === "pbs") return null
  if (!STORAGE_ID_RE.test(storage)) return NextResponse.json({ error: "Invalid storage id" }, { status: 400 })

  return removeClusterStorage(req, id, storage, conn, cfg)
}

/**
 * Removes a storage that is not a PBS one (roadmap#202): refused while a guest
 * volume sits on it or a backup job writes to it. Proxmox only drops the
 * configuration, the data stays where it is. When a node could not be read
 * (storage offline), the caller decides with `?force=1`.
 */
async function removeClusterStorage(req: Request, id: string, storage: string, conn: any, cfg: Record<string, any>) {
  const force = new URL(req.url).searchParams.get("force") === "1"
  const nodes = await pveFetch<any[]>(conn, "/nodes").catch(() => [])
  const usage = await storageUsage(conn, storage, cfg, (nodes || []).map((n: any) => String(n?.node)).filter(Boolean))

  if (usage.volumes.length || usage.backupJobs.length || usage.dependents.length) {
    return NextResponse.json({
      error: "This storage is still in use",
      code: "STORAGE_IN_USE",
      vmids: [...new Set(usage.volumes.map(v => v.vmid))],
      volumes: usage.volumes.length,
      backupJobs: usage.backupJobs,
      storages: usage.dependents,
    }, { status: 409 })
  }

  if (usage.unverified.length && !force) {
    return NextResponse.json({ error: "The usage of this storage could not be read everywhere", code: "STORAGE_USAGE_UNVERIFIED", unverified: usage.unverified }, { status: 409 })
  }

  await pveFetch<any>(conn, `/storage/${encodeURIComponent(storage)}`, { method: "DELETE" })

  await audit({
    action: "delete",
    category: "storage",
    resourceType: "storage",
    resourceId: storage,
    resourceName: storage,
    status: "success",
    details: { connectionId: id, connectionName: conn.name, type: cfg.type, forced: force && usage.unverified.length > 0, unverified: usage.unverified },
  })

  return NextResponse.json({ data: { storage, removed: true } })
}

/**
 * DELETE /api/v1/connections/[id]/storage/[storage]
 *
 * Detaches a `pbs:` storage from the cluster (issue #890) and revokes the
 * scoped token ProxCenter minted for it, unless another cluster still runs
 * its backups through that same token.
 */
async function deleteHandler(
  _req: Request,
  ctx: { params: Promise<{ id: string; storage: string }> | { id: string; storage: string } },
) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  const storage = (params as any)?.storage

  if (!id || !storage) return NextResponse.json({ error: "Missing params" }, { status: 400 })

  const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

  if (denied) return denied

  const tenantId = await getCurrentTenantId()

  if (maskingScope(await getTenantInfrastructureScope(tenantId))) {
    return NextResponse.json(
      { error: "Detaching a storage is reserved to the owner of the cluster" },
      { status: 403 },
    )
  }

  try {
    const conn = await getConnectionById(id)

    // Not a PBS storage: the generic removal, with its usage check.
    const other = await removeIfNotPbs(_req, id, String(storage), conn)

    if (other) return other

    const prisma = await getSessionPrisma()

    // Both lists stay inside the caller's tenant: the token-reuse check must
    // not read a cluster the caller cannot see, and a PBS outside the tenant
    // is not ours to revoke a token on.
    const rows = await prisma.connection.findMany({
      where: { type: { in: ["pve", "pbs"] } },
      select: { id: true, name: true, type: true },
    })

    const siblings = rows.filter(r => r.type === "pve" && r.id !== id)
    const pbsConnectionIds = rows.filter(r => r.type === "pbs").map(r => r.id)

    const siblingConns = []
    const unverifiableConns = []

    for (const row of siblings) {
      try {
        siblingConns.push(await getConnectionById(row.id))
      } catch (e: any) {
        // A row we cannot resolve (denied, no credential, decrypt failure)
        // cannot be cleared of token reuse. Hand it over as unverifiable so
        // the token is kept, rather than dropping it and revoking a
        // credential this cluster may still be running its backups with.
        console.warn(`[pbs-detach] cannot resolve sibling ${row.id}: ${e?.message ?? e}`)
        unverifiableConns.push(row.name)
      }
    }

    const result = await detachPbsStorage({
      pveConn: conn,
      storage: String(storage),
      siblingConns,
      unverifiableConns,
      pbsConnectionIds,
    })

    await audit({
      action: "delete",
      category: "storage",
      resourceType: "storage",
      resourceId: result.storage,
      resourceName: result.storage,
      status: result.token === "revoke-failed" ? "warning" : "success",
      details: {
        connectionId: id,
        connectionName: conn.name,
        type: "pbs",
        token: result.token,
        tokenId: result.tokenId ?? null,
        usedBy: result.usedBy ?? null,
      },
    })

    return NextResponse.json({ data: result })
  } catch (e: any) {
    if (e instanceof PveApplicationError) return pveErrorResponse(e)

    const status = e instanceof PbsAttachError ? e.status : 500
    const message = e?.message || String(e)

    await audit({
      action: "delete",
      category: "storage",
      resourceType: "storage",
      resourceId: String(storage),
      resourceName: String(storage),
      status: "failure",
      errorMessage: message,
      details: { connectionId: id, type: "pbs" },
    })

    return NextResponse.json(
      { error: message, ...(e instanceof PbsAttachError ? { code: e.code } : {}) },
      { status },
    )
  }
}

export const GET = withPublicApiGuard("storage-config-read", getHandler)
export const PUT = withAudit({ category: "storage", resourceType: "storage", resourceParam: "storage" }, withPublicApiGuard("storage-update", putHandler))
export const DELETE = withAudit({ category: "storage", resourceType: "storage", resourceParam: "storage" }, withPublicApiGuard("storage-detach", deleteHandler))
