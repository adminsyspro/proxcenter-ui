export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sViewCluster } from '@/lib/k8s/requireK8sViewCluster'
import { getClusterTopology } from '@/lib/k8s/server/topology'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const gate = await requireK8sViewCluster(id)
  if (!gate.ok) return gate.response

  const nsParam = new URL(req.url).searchParams.get('namespace')
  const namespace = nsParam === 'all' ? null : (nsParam || null)

  const r = await getClusterTopology({
    clusterId: id,
    credentialVersion: gate.cluster.credentialVersion,
    cred: gate.credential,
    tenantId: gate.tenantId,
    namespace,
    proxmoxConnectionId: gate.cluster.proxmoxConnectionId ?? null,
  })

  if (!r.ok) return NextResponse.json({ error: 'cluster unreachable' }, { status: 502 })
  return NextResponse.json(r.value, { status: 200 })
}
