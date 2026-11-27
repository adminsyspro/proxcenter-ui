import { NextResponse } from 'next/server'
import { getServerLicense } from '@/lib/auth/requireEnterprise'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { PERMISSIONS } from '@/lib/rbac'

/**
 * Guard for K8s provisioning routes: Talos deployment is an Enterprise-only
 * capability. requireK8sPermission alone is not enough here because it is
 * edition-aware and grants Community super-admins access (explore heritage).
 * This guard fails closed on Community BEFORE even consulting the permission
 * check, then delegates to requireK8sPermission for the fine-grained grant.
 */
export async function requireK8sProvision(): Promise<Response | null> {
  const lic = await getServerLicense()
  if (!lic.enterprise) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return requireK8sPermission(PERMISSIONS.K8S_PROVISION)
}
