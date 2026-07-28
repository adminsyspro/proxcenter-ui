import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"

import { requireApiTokenAdmin, tenantVisibleToCaller } from "../_shared"

export const runtime = "nodejs"

// Soft revocation: revoked_at is set, the row is KEPT for the audit trail
// (spec section 5). Idempotent. NOT license-gated (D6): an administrator
// can still revoke a token after the option lapses.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const guard = await requireApiTokenAdmin()
  if (!guard.ok) return guard.response!

  const rbac = guard.ctx!

  const params = await Promise.resolve(ctx.params)
  const id = params?.id
  if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

  const token = await prisma.apiToken.findUnique({
    where: { id },
    select: { id: true, name: true, tenantId: true, revokedAt: true },
  })
  const visible = token && (await tenantVisibleToCaller(rbac, token.tenantId))
  if (!visible) return NextResponse.json({ error: "API token not found" }, { status: 404 })

  const revokedAt = token.revokedAt ?? new Date()
  if (!token.revokedAt) {
    await prisma.apiToken.update({ where: { id }, data: { revokedAt } })
    await audit({
      action: "apitoken.revoke",
      category: "api_tokens",
      resourceType: "api_token",
      resourceId: id,
      resourceName: token.name,
    })
  }

  return NextResponse.json({ data: { id, revokedAt: revokedAt.toISOString() } })
}
