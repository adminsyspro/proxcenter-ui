import { discoverReplicationStorages, replicationDiscovery } from '@/lib/proxmox/replicationDiscovery'
import { denyIaasTenant } from "@/lib/tenant/iaasGuard"

export const runtime = 'nodejs'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const iaasDenied = await denyIaasTenant()
  if (iaasDenied) return iaasDenied

  return replicationDiscovery(ctx, ({ configs, resources }) => discoverReplicationStorages(configs, resources))
}
