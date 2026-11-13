// Gate of the vDC GPU quota route (#672), the one GPU route the public API
// opens (issue #1360). Same rule as requireGpuSettings: provider tenant only
// (another tenant gets a 404), the licence, then the permission. The caller
// is resolved through the principal, so an API token of the provider tenant
// is judged like its session counterpart and the route never reads the
// session itself.
import { getPrincipal } from '@/lib/auth/principal'
import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { checkPermission } from '@/lib/rbac'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'

import { gpuCode, gpuFeatureRequired } from './metrics'

/** `permission`: admin.settings.view to read the contingent, admin.settings.vdcs to replace it. */
export async function requireGpuQuotaAccess(permission: string): Promise<Response | null> {
  const result = await getPrincipal()
  const principal = result.ok ? result.principal : undefined
  if (!principal || (principal.kind === 'session' && !principal.userId)) return gpuCode('not_authenticated', 401)
  const notFound = gpuCode('not_found', 404)
  if (principal.tenantId !== DEFAULT_TENANT_ID) return notFound
  try {
    if ((await getCurrentTenantId()) !== DEFAULT_TENANT_ID) return notFound
  } catch {
    return notFound
  }
  if (!(await hasServerFeature(Features.GPU_MANAGEMENT))) return gpuFeatureRequired()
  return checkPermission(permission)
}
