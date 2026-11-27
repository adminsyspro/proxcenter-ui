// Who may create or destroy the VMs of a Kubernetes cluster on a Proxmox
// connection. The orchestrator acts with the connection's own token, so these
// checks are the only ones between a caller and the cluster: the connection
// must belong to the caller's tenant, and the caller must hold the VM
// permission on it, as for creating a guest by hand.

import { NextResponse } from 'next/server'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'

export type ProvisionAccessAction = 'create' | 'delete'

/**
 * null when allowed, else the response to answer with:
 * - a tenant that rents a slice of a provider cluster (vDC) cannot deploy:
 *   the deployment would create VMs outside its vDC quotas and pools;
 * - a tenant that owns whole connections deploys only on its own;
 * - the caller needs vm.create (or vm.delete) on the connection.
 */
export async function requireProvisionTarget(
  tenantId: string,
  connectionId: string,
  action: ProvisionAccessAction,
): Promise<Response | null> {
  const infra = await getTenantInfrastructureScope(tenantId)
  if (infra.kind === 'iaas') {
    return NextResponse.json({ error: 'tenant_vdc_unsupported' }, { status: 403 })
  }
  if (infra.kind === 'msp' && !infra.connectionIds.has(connectionId)) {
    // Same answer as an unknown connection: another tenant's ids stay unconfirmed.
    return NextResponse.json({ error: 'connection_not_found' }, { status: 404 })
  }
  const permission = action === 'create' ? PERMISSIONS.VM_CREATE : PERMISSIONS.VM_DELETE
  return checkPermission(permission, 'connection', connectionId)
}
