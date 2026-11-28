import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { ClusterStorageError, sanLunsOfTarget } from "@/lib/storage/clusterStorage"
import { STORAGE_ID_RE } from "@/lib/storage/clusterStorageTypes"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; node: string }> | { id: string; node: string } }

/**
 * GET /api/v1/connections/[id]/nodes/[node]/san-luns?storage=<iscsi storage>
 *
 * The LUNs one node reaches through the target of an iSCSI storage, with their
 * paths, health and usage (issue #1436), read from the SAN view of Proxmox VE
 * 9.3. The Add dialog shows them while an LVM is built on one of them. `data`
 * is null before 9.3: the LUN list then goes without these details.
 */
async function getHandler(req: Request, ctx: Ctx) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  const node = (params as any)?.node

  if (!id || !node) return NextResponse.json({ error: "Missing params" }, { status: 400 })

  const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

  if (denied) return denied

  if (maskingScope(await getTenantInfrastructureScope(await getCurrentTenantId()))) {
    return NextResponse.json({ error: "Adding a storage is reserved to the owner of the cluster" }, { status: 403 })
  }

  const storage = new URL(req.url).searchParams.get("storage") ?? ""

  if (!STORAGE_ID_RE.test(storage)) return NextResponse.json({ error: "Invalid storage id" }, { status: 400 })

  try {
    const conn = await getConnectionById(id)
    const cfg = await pveFetch<any>(conn, `/storage/${encodeURIComponent(storage)}`)

    if (cfg?.type !== "iscsi" || !cfg?.target) return NextResponse.json({ error: "Not an iSCSI storage" }, { status: 400 })

    return NextResponse.json({ data: await sanLunsOfTarget(conn, String(node), String(cfg.target)) })
  } catch (e: any) {
    if (e instanceof ClusterStorageError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })

    return NextResponse.json({ error: "Could not read the LUNs" }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("storage-san-luns", getHandler)
