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
// Since #903 the scope also carries the per-tenant and per-vDC grants (see
// catalogGrants.ts): `isShared` is the "everyone" shortcut, a grant opens a
// single provider entry to one tenant or one vDC.
//
// The global prisma client is deliberate: the tenant-scoped extension refuses
// rows owned by another tenant, and a shared or granted catalogue entry is
// owned by the provider by design. Sharing and granting are provider-only, so
// widening the read to those rows does not expose anything a tenant was not
// meant to see.

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/prisma'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'

import { customImageVisibilityWhere, granteeVdcIds, type VisibilityOpts } from './catalogGrants'

/**
 * The `where` clause matching every custom image the tenant may use: its own
 * rows, the provider's shared catalogue entries, and the provider entries
 * granted to the tenant or to one of the `vdcIds`. The provider sees only its
 * own rows (shared and private alike), which is already everything it owns.
 */
export function customImageScopeWhere(tenantId: string, vdcIds: string[] = []): Prisma.CustomImageWhereInput {
  return customImageVisibilityWhere(tenantId, vdcIds)
}

/**
 * Resolve a single custom image by slug within the caller's scope.
 *
 * A tenant's own slug wins over a shared one carrying the same slug: the row
 * the tenant owns is the more specific answer, and it keeps a provider
 * publishing a colliding slug from shadowing an image a tenant already
 * deploys. Returns null when the slug is outside the scope.
 *
 * A provider row reached by a tenant comes back with `visibleViaGrant` set
 * when the reason is a grant rather than `isShared`: the deploy pipeline
 * treats both as the provider publishing that exact source to the tenant.
 */
export async function findCustomImageForTenant(tenantId: string, slug: string, opts?: VisibilityOpts) {
  const vdcIds = await granteeVdcIds(tenantId, opts)
  const rows = await prisma.customImage.findMany({
    where: { AND: [{ slug }, customImageScopeWhere(tenantId, vdcIds)] },
  })

  if (rows.length === 0) return null

  const row = rows.find(r => r.tenantId === tenantId) ?? rows[0]
  const visibleViaGrant = row.tenantId === DEFAULT_TENANT_ID && tenantId !== DEFAULT_TENANT_ID && !row.isShared
  return { ...row, visibleViaGrant }
}

/**
 * True when the provider owns an image with this slug: the slug is real but
 * hidden from the caller, which deserves a 403 rather than "unknown".
 */
export async function isProviderImageSlug(slug: string): Promise<boolean> {
  const row = await prisma.customImage.findFirst({ where: { slug, tenantId: DEFAULT_TENANT_ID }, select: { id: true } })
  return !!row
}
