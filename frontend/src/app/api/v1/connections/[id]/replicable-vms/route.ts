import { NextResponse } from 'next/server'

import { discoverReplicableVMs, replicationDiscovery } from '@/lib/proxmox/replicationDiscovery'
import { denyIaasTenant } from "@/lib/tenant/iaasGuard"

export const runtime = 'nodejs'

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const iaasDenied = await denyIaasTenant()
  if (iaasDenied) return iaasDenied

  const engine = new URL(request.url).searchParams.get('engine')

  if (engine !== 'rbd' && engine !== 'zfs') {
    return NextResponse.json({ error: 'engine must be rbd or zfs' }, { status: 400 })
  }

  return replicationDiscovery(ctx, context => discoverReplicableVMs(context, engine))
}
