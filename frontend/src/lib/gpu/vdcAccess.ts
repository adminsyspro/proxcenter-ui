// Gate of the vDC GPU routes (#672): who may reach a vDC's GPU contingent.
// Kept apart from vdcContext.ts because it reads the session: the guest
// routes an API token may call must not reach a session read.
import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'
import { getVdcById } from '@/lib/vdc'

import { sessionUser } from './guard'
import { gpuCode, gpuFeatureRequired } from './metrics'
import type { VdcRef } from './vdcContext'
import { listVdcGpuEntries } from './vdcEntries'

export type VdcGpuAccess = { denied: Response } | { denied: null; vdc: VdcRef; isProvider: boolean; userId: string }

/**
 * Gate of the vDC GPU routes. Every refusal past the session and the licence
 * is a 404, so nothing tells whether the vDC exists. The provider may read any
 * vDC with a contingent but never writes through these routes.
 */
export async function requireVdcGpuAccess(vdcId: string, opts: { write: boolean }): Promise<VdcGpuAccess> {
  const user = await sessionUser()
  if (!user) return { denied: gpuCode('not_authenticated', 401) }
  if (!(await hasServerFeature(Features.GPU_MANAGEMENT))) return { denied: gpuFeatureRequired() }
  const notFound = { denied: gpuCode('not_found', 404) }

  let tenantId: string
  try {
    tenantId = await getCurrentTenantId()
  } catch {
    return notFound
  }
  const vdc = await getVdcById(vdcId)
  if (!vdc) return notFound
  const isProvider = tenantId === DEFAULT_TENANT_ID
  if (isProvider ? opts.write : vdc.tenantId !== tenantId) return notFound
  if (vdc.enabled === false) return notFound
  if ((await listVdcGpuEntries(vdc.id)).length === 0) return notFound

  return {
    denied: null,
    isProvider,
    userId: user.id,
    vdc: {
      id: vdc.id,
      tenantId: vdc.tenantId,
      connectionId: vdc.connectionId,
      pvePoolName: vdc.pvePoolName,
      enabled: vdc.enabled,
    },
  }
}
