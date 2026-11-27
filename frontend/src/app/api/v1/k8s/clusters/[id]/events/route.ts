export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sViewCluster } from '@/lib/k8s/requireK8sViewCluster'
import { listEvents } from '@/lib/k8s/orchestrator'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const gate = await requireK8sViewCluster(id)
  if (!gate.ok) return gate.response

  const sp = new URL(req.url).searchParams
  const r = await listEvents({
    clusterId: id,
    credentialVersion: gate.cluster.credentialVersion,
    cred: gate.credential,
    namespace: sp.get('namespace') || undefined,
    involvedUid: sp.get('uid') || undefined,
    involvedName: sp.get('name') || undefined,
  })
  if (!r.ok) return NextResponse.json({ error: 'orchestrator unreachable' }, { status: 502 })
  return NextResponse.json(r.value, { status: 200 })
}
