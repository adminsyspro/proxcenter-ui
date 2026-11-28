import { requireFeature } from '@/lib/auth/requireEnterprise'
import { checkPermission } from '@/lib/rbac'
import { Features } from '@/lib/license/features'

/**
 * Guard of every Kubernetes route: the feature is Enterprise only (403 on
 * any other edition, super-admins included, and when the orchestrator cannot
 * tell the edition), then the RBAC permission decides.
 */
export async function requireK8sPermission(permission: string): Promise<Response | null> {
  const unlicensed = await requireFeature(Features.KUBERNETES)
  if (unlicensed) return unlicensed
  return checkPermission(permission, 'global')
}
