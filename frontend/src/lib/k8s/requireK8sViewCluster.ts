import { NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/rbac'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { getClusterWithCredential } from '@/lib/k8s/repository'
import type { SanitizedCredential } from './types'

export async function requireK8sViewCluster(
  id: string,
): Promise<
  | { ok: true; tenantId: string; cluster: any; credential: SanitizedCredential; response?: undefined }
  | { ok: false; tenantId?: undefined; cluster?: undefined; credential?: undefined; response: Response }
> {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_VIEW)
  if (denied) return { ok: false, response: denied }
  const tenant = await resolveStrictTenant()
  if (!tenant.ok) return { ok: false, response: tenant.response }
  const found = await getClusterWithCredential(tenant.tenantId, id)
  if (!found) return { ok: false, response: NextResponse.json({ error: 'Cluster not found' }, { status: 404 }) }
  return { ok: true, tenantId: tenant.tenantId, cluster: found.row, credential: found.credential }
}
