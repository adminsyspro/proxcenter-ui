import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"

import { requireApiTokenAdmin, tenantVisibleToCaller } from "../_shared"

export const runtime = "nodejs"

// Hard delete: the row is REMOVED. This replaced the original soft revocation
// (spec section 5, revoked_at kept for the audit trail) on owner feedback --
// "supprimer" has to mean the token is gone, not greyed out in the table.
//
// The audit trail does not depend on the row surviving: audit_logs.api_token_id
// was created deliberately WITHOUT a foreign key precisely so journal entries
// outlive the token they describe (see the 20260728000000_api_tokens
// migration). What is genuinely lost is the token's own history, last_used_at
// above all -- that is the accepted cost of the row disappearing.
//
// NOT idempotent, unlike the revocation it replaces: a second DELETE on the
// same id answers 404. That is the honest answer once the row is gone, and the
// only caller reloads the list rather than reading this response.
//
// NOT license-gated (D6): an administrator can still delete a token after the
// option lapses.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const guard = await requireApiTokenAdmin()
  if (!guard.ok) return guard.response!

  const rbac = guard.ctx!

  const params = await Promise.resolve(ctx.params)
  const id = params?.id
  if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

  const token = await prisma.apiToken.findUnique({
    where: { id },
    select: { id: true, name: true, tenantId: true, tokenPrefix: true },
  })
  const visible = token && (await tenantVisibleToCaller(rbac, token.tenantId))
  if (!visible) return NextResponse.json({ error: "API token not found" }, { status: 404 })

  // Atomic with the audit row (fix round 1, finding 1): if the audit insert
  // fails, the delete must roll back too. A credential vanishing with no
  // journal entry to show for it is worse here than it was for revocation --
  // there would be nothing left anywhere to say the token ever existed.
  try {
    await prisma.$transaction(async tx => {
      await tx.apiToken.delete({ where: { id } })
      await audit(
        {
          action: "apitoken.delete",
          category: "api_tokens",
          resourceType: "api_token",
          resourceId: id,
          resourceName: token.name,
          // The prefix is the only identifier that survives the row, and it
          // is what an operator reads to recognise which integration this was.
          details: { tokenPrefix: token.tokenPrefix },
        },
        tx,
      )
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 })
  }

  return NextResponse.json({ data: { id, deleted: true } })
}
