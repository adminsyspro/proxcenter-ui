import { prisma } from "@/lib/db/prisma"
import { DEFAULT_TENANT_ID } from "@/lib/tenant"

export const BUILT_IN_CATALOG_HIDDEN = "The built-in image catalogue is not available to this tenant"

/**
 * Whether the provider turned the built-in image catalogue off for this
 * tenant. The tenant then only sees the provider's images granted or shared
 * with it and its own; the catalogue list, the image probe and the deploy
 * route all apply it, so a hidden slug cannot be deployed by calling the API
 * directly. The provider tenant always keeps the catalogue.
 */
export async function isBuiltInCatalogHidden(tenantId: string): Promise<boolean> {
  if (tenantId === DEFAULT_TENANT_ID) return false
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { builtInCatalog: true } })
  return tenant?.builtInCatalog === false
}
