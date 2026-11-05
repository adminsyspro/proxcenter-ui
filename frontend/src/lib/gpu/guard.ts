// Gates of the GPU load routes (#672), Enterprise (gpu_management).
//
// Reads: session, licence, then vm.view or node.view like the GPU inventory;
// what a caller sees is then narrowed by its visible report (lib/gpu/metrics).
// Settings and probes: provider tenant only (another tenant gets a 404), and
// admin.settings, since opting a VM in runs a command inside it.
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'

import { gpuCode, gpuFeatureRequired } from './metrics'

export type GpuAccess = { denied: Response } | { denied: null; userId: string }

export async function sessionUser(): Promise<{ id: string; tenantId?: string } | null> {
  const session = await getServerSession(authOptions)
  const user = (session as { user?: { id?: string; tenantId?: string } } | null)?.user
  return user?.id ? { id: user.id, tenantId: user.tenantId } : null
}

/**
 * A vDC tenant (neither the provider nor an MSP running its own clusters) has
 * no GPU page: it gets a 404, as if the feature did not exist (#672).
 */
export async function vdcTenantDenied(): Promise<Response | null> {
  const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
  return infra.kind === 'iaas' ? gpuCode('not_found', 404) : null
}

export async function requireGpuRead(): Promise<GpuAccess> {
  const user = await sessionUser()
  if (!user) return { denied: gpuCode('not_authenticated', 401) }
  if (!(await hasServerFeature(Features.GPU_MANAGEMENT))) return { denied: gpuFeatureRequired() }
  const vdc = await vdcTenantDenied()
  if (vdc) return { denied: vdc }
  const deniedVm = await checkPermission(PERMISSIONS.VM_VIEW)
  if (deniedVm) {
    const deniedNode = await checkPermission(PERMISSIONS.NODE_VIEW)
    if (deniedNode) return { denied: deniedVm }
  }
  return { denied: null, userId: user.id }
}

export async function requireGpuSettings(): Promise<GpuAccess> {
  const user = await sessionUser()
  if (!user) return { denied: gpuCode('not_authenticated', 401) }
  const notFound = { denied: gpuCode('not_found', 404) }
  if (user.tenantId && user.tenantId !== DEFAULT_TENANT_ID) return notFound
  try {
    if ((await getCurrentTenantId()) !== DEFAULT_TENANT_ID) return notFound
  } catch {
    return notFound
  }
  if (!(await hasServerFeature(Features.GPU_MANAGEMENT))) return { denied: gpuFeatureRequired() }
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return { denied }
  return { denied: null, userId: user.id }
}

/**
 * GPU actions (attach, release): provider tenant only (another tenant gets a
 * 404) and the licence; the RBAC of each action is checked on its VM and node.
 */
export async function requireGpuActions(): Promise<GpuAccess> {
  const user = await sessionUser()
  if (!user) return { denied: gpuCode('not_authenticated', 401) }
  const notFound = { denied: gpuCode('not_found', 404) }
  if (user.tenantId && user.tenantId !== DEFAULT_TENANT_ID) return notFound
  try {
    if ((await getCurrentTenantId()) !== DEFAULT_TENANT_ID) return notFound
  } catch {
    return notFound
  }
  if (!(await hasServerFeature(Features.GPU_MANAGEMENT))) return { denied: gpuFeatureRequired() }
  return { denied: null, userId: user.id }
}

/** GPU chargeback reads: provider tenant, the licence and reports.view. */
export async function requireGpuBilling(): Promise<GpuAccess> {
  const access = await requireGpuActions()
  if (access.denied) return access
  const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)
  if (denied) return { denied }
  return access
}
