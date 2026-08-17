// Offboarding support for API tokens (issue #632).
//
// A `pxc_` token is an autonomous row: validation checks the hash, the
// revocation and expiry stamps and the tenant, never the account that
// created it (spec 2026-07-28, decision D3). That is deliberate — a token
// driving Prometheus must not die because the admin who minted it left the
// company, and taking monitoring down in the middle of an offboarding would
// be the worse failure.
//
// The gap it left is one of visibility, not of authorisation: an admin
// disables a departing colleague, reasonably believes access is cut, and
// nothing anywhere connects the two facts. These helpers let the user
// admin SEE the credentials that will keep working and delete them in the
// same gesture, without ever making that deletion automatic.
import { prisma } from "@/lib/db/prisma"

export type CreatorTokenSummary = {
  id: string
  name: string
  tokenPrefix: string
  tenantId: string
  tenantName: string | null
  scopes: unknown
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}

/**
 * Tokens created by `userId` that would still authenticate right now:
 * neither revoked nor past their expiry. An expired token needs no
 * offboarding decision, and listing it would only pad the warning. The
 * `revokedAt` half of that filter still matters even though nothing writes
 * the column any more: existing databases hold rows revoked back when the
 * delete button was a soft revocation, and those must not be re-offered.
 *
 * `tenantId` narrows the search to a single tenant, for callers acting from
 * a tenant-scoped view rather than the provider view.
 */
export async function listActiveTokensCreatedBy(
  userId: string,
  tenantId?: string,
): Promise<CreatorTokenSummary[]> {
  const rows = await prisma.apiToken.findMany({
    where: activeCreatedByWhere(userId, tenantId),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      tenantId: true,
      tenant: { select: { name: true } },
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  })

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? null,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }))
}

/**
 * Delete every still-active token created by `userId`, returning what was
 * deleted so the caller can put it in the audit trail.
 *
 * Deletion, not a revocation stamp: "delete a token" means the row is gone,
 * the same semantics as the delete button in the tokens table. The journal
 * entry is what survives — audit_logs.api_token_id has no foreign key exactly
 * so it can outlive the row — which is why the caller records the prefixes.
 *
 * Call this BEFORE deleting the user: `created_by_user_id` is ON DELETE SET
 * NULL, so once the account is gone these tokens can no longer be found by
 * creator and the chance to act on them is lost for good.
 */
export async function deleteTokensCreatedBy(
  userId: string,
  tenantId?: string,
): Promise<{ count: number; tokens: { id: string; name: string; tokenPrefix: string }[] }> {
  const doomed = await prisma.apiToken.findMany({
    where: activeCreatedByWhere(userId, tenantId),
    select: { id: true, name: true, tokenPrefix: true },
  })
  if (doomed.length === 0) return { count: 0, tokens: [] }

  // `count` is what was actually removed, `tokens` is what was targeted. They
  // diverge only if someone deletes one of these tokens between the two
  // queries, in which case the audit entry names a prefix this call did not
  // remove itself. Reporting the delete count honestly beats using
  // tokens.length, which would claim removals that may not have happened.
  const deleted = await prisma.apiToken.deleteMany({
    where: { id: { in: doomed.map(t => t.id) } },
  })

  return { count: deleted.count, tokens: doomed }
}

function activeCreatedByWhere(userId: string, tenantId?: string) {
  return {
    createdByUserId: userId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    ...(tenantId ? { tenantId } : {}),
  }
}
