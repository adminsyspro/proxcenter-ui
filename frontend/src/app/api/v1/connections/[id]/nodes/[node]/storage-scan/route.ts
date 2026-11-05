import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { ClusterStorageError, scanStorageTarget } from "@/lib/storage/clusterStorage"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; node: string }> | { id: string; node: string } }

/**
 * POST /api/v1/connections/[id]/nodes/[node]/storage-scan
 *
 * Tests a storage target from one node before it is added (roadmap#202): the
 * NFS exports of a server, the shares of a CIFS server (wrong credentials are
 * reported here), the targets of an iSCSI portal, the LVM volume groups of the
 * node. A POST because a CIFS password travels in the body, never in a URL.
 *
 * One scan at a time per node, held until Proxmox actually ended it: see
 * scanStorageTarget. Not audited: it reads, and its body may carry a secret.
 */
async function postHandler(req: Request, ctx: Ctx) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  const node = (params as any)?.node

  if (!id || !node) return NextResponse.json({ error: "Missing params" }, { status: 400 })

  const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

  if (denied) return denied

  if (maskingScope(await getTenantInfrastructureScope(await getCurrentTenantId()))) {
    return NextResponse.json({ error: "Adding a storage is reserved to the owner of the cluster" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)

  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

  try {
    const conn = await getConnectionById(id)
    const entries = await scanStorageTarget(conn, id, String(node), body)

    return NextResponse.json({ data: entries })
  } catch (e: any) {
    if (e instanceof ClusterStorageError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })

    return NextResponse.json({ error: "Connection test failed" }, { status: 500 })
  }
}

export const POST = withPublicApiGuard("storage-scan", postHandler)
