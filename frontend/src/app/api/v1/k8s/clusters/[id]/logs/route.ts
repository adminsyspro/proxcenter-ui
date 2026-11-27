export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sViewCluster } from '@/lib/k8s/requireK8sViewCluster'
import { fetchPodLogs } from '@/lib/k8s/orchestrator'
import { audit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const gate = await requireK8sViewCluster(id)
  if (!gate.ok) return gate.response

  const sp = new URL(req.url).searchParams
  const namespace = sp.get('namespace') || ''
  const pod = sp.get('pod') || ''
  if (!namespace || !pod) return NextResponse.json({ error: 'namespace and pod required' }, { status: 400 })

  const tailRaw = sp.get('tailLines')
  const r = await fetchPodLogs({
    clusterId: id,
    credentialVersion: gate.cluster.credentialVersion,
    cred: gate.credential,
    namespace,
    pod,
    container: sp.get('container') || undefined,
    tailLines: tailRaw ? Number(tailRaw) : undefined,
    previous: sp.get('previous') === '1',
  })

  const resourceName = gate.cluster.name
  if (!r.ok) {
    await audit({ action: 'logs', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName, status: 'failure' })
    return NextResponse.json({ error: 'orchestrator unreachable' }, { status: 502 })
  }
  await audit({ action: 'logs', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName, status: 'success' })
  return NextResponse.json(r.value, { status: 200 })
}
