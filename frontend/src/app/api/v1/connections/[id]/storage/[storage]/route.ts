import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { detachPbsStorage, PbsAttachError } from "@/lib/storage/attachPbsStorage"
import { audit } from "@/lib/audit"

export const runtime = "nodejs"

/**
 * DELETE /api/v1/connections/[id]/storage/[storage]
 *
 * Detaches a `pbs:` storage from the cluster (issue #890) and revokes the
 * scoped token ProxCenter minted for it, unless another cluster still runs
 * its backups through that same token.
 */
export async function DELETE(
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
