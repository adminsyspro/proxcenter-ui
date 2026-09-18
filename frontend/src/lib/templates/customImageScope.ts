// src/lib/templates/customImageScope.ts
//
// One place that decides which custom images a tenant may see AND deploy.
//
// The catalogue and the deploy route used to answer that question with two
// different queries: the catalogue reached into the provider tenant for
// `isShared` rows, the deploy route looked the slug up under the caller's own
// tenant only. A template the provider shared with every tenant was therefore
// listed for the tenant and then refused at deploy with "Unknown image slug".
// Both callers now go through the helpers below so the two lists cannot drift
// apart again.
//
// The global prisma client is deliberate: the tenant-scoped extension refuses
// rows owned by another tenant, and a shared catalogue entry is owned by the
// provider by design. Sharing is opt-in and provider-only (`isShared` can only
// be set from the 'default' tenant), so widening the read to those rows does
// not expose anything a tenant was not meant to see.

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/prisma'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'

/**
 * The `where` clause matching every custom image the tenant may use: its own
 * rows, plus the provider's shared catalogue entries. The provider sees only
 * its own rows (shared and private alike), which is already everything it owns.
 */
export function customImageScopeWhere(tenantId: string): Prisma.CustomImageWhereInput {
  if (tenantId === DEFAULT_TENANT_ID) return { tenantId }

  return {
    OR: [
      { tenantId },
      { tenantId: DEFAULT_TENANT_ID, isShared: true },
    ],
  }
}

/**
 * Resolve a single custom image by slug within the caller's scope.
 *
 * A tenant's own slug wins over a shared one carrying the same slug: the row
 * the tenant owns is the more specific answer, and it keeps a provider
 * publishing a colliding slug from shadowing an image a tenant already
 * deploys. Returns null when the slug is outside the scope.
 */
export async function findCustomImageForTenant(tenantId: string, slug: string) {
  const rows = await prisma.customImage.findMany({
    where: { AND: [{ slug }, customImageScopeWhere(tenantId)] },
  })

  if (rows.length === 0) return null

  return rows.find(row => row.tenantId === tenantId) ?? rows[0]
}
