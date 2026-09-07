import { discoverReplicationStorages, replicationDiscovery } from '@/lib/proxmox/replicationDiscovery'

export const runtime = 'nodejs'

export function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return replicationDiscovery(ctx, ({ configs, resources }) => discoverReplicationStorages(configs, resources))
}
