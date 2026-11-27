export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sViewCluster } from '@/lib/k8s/requireK8sViewCluster'
import { listDeploymentRevisions } from '@/lib/k8s/orchestrator'
import { isValidName, isValidNamespace } from '@/lib/k8s/workloadActions'

type Ctx = { params: Promise<{ id: string }> }

/** Revisions of a Deployment (its ReplicaSets), newest first, for the rollback dialog. */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const gate = await requireK8sViewCluster(id)
  if (!gate.ok) return gate.response

  const sp = new URL(req.url).searchParams
  const namespace = sp.get('namespace')
  const name = sp.get('name')
  if (!isValidNamespace(namespace) || !isValidName(name)) {
    return NextResponse.json({ error: 'namespace and name required' }, { status: 400 })
  }
  const r = await listDeploymentRevisions({
    clusterId: id, credentialVersion: gate.cluster.credentialVersion, cred: gate.credential, namespace, name,
  })
  if (!r.ok) {
    let status = 502
    if (r.error === 'not_found') status = 404
    else if (r.error === 'forbidden') status = 403
    return NextResponse.json({ error: r.error }, { status })
  }
  return NextResponse.json(r.value, { status: 200 })
}
