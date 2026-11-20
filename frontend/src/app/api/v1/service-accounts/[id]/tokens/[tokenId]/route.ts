// /api/v1/service-accounts/{id}/tokens/{tokenId} (issue #1404): revoke one
// token of a service account. The row is deleted; its audit trail stays.
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { deleteApiToken } from "@/lib/api-tokens/mint"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"
import { identityWriter, notFound, reachableServiceAccount } from "@/lib/service-accounts/access"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; tokenId: string }> }

async function handleDelete(_req: Request, ctx: Ctx) {
  const caller = await identityWriter()
  if (caller.denied) return caller.denied
  const { id, tokenId } = await ctx.params
  if (!(await reachableServiceAccount(caller, id))) return notFound()
  const token = await prisma.apiToken.findFirst({
    where: { id: tokenId, serviceAccountId: id },
    select: { id: true, name: true, tokenPrefix: true },
  })
  if (!token) return NextResponse.json({ error: "API token not found" }, { status: 404 })
  try {
    await deleteApiToken(token)
    return NextResponse.json({ data: { id: tokenId, deleted: true } })
  } catch (e) {
    console.error("[service-accounts] token deletion failed:", (e as Error)?.message ?? e)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

export const DELETE = withAudit({ category: "api_tokens", resourceType: "api_token", resourceParam: "tokenId" }, withPublicApiGuard("service-account-token-delete", handleDelete))
