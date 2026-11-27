export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sViewCluster } from '@/lib/k8s/requireK8sViewCluster'
import { fetchNodeMetrics, fetchPodMetrics } from '@/lib/k8s/orchestrator'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const gate = await requireK8sViewCluster(id)
  if (!gate.ok) return gate.response

  const base = { clusterId: id, credentialVersion: gate.cluster.credentialVersion, cred: gate.credential }
  // ?scope=pod → per-pod CPU/RAM (% of the pod's node capacity); default = nodes.
  const scope = new URL(req.url).searchParams.get('scope')
  const r = scope === 'pod' ? await fetchPodMetrics(base) : await fetchNodeMetrics(base)
  if (!r.ok) return NextResponse.json({ error: 'orchestrator unreachable' }, { status: 502 })
  return NextResponse.json(r.value, { status: 200 })
}
