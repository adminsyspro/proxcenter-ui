export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sViewCluster } from '@/lib/k8s/requireK8sViewCluster'
import { listResources, getResource } from '@/lib/k8s/orchestrator'
import { kindByApiKind } from '@/lib/k8s/resourceKinds'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const gate = await requireK8sViewCluster(id)
  if (!gate.ok) return gate.response

  const sp = new URL(req.url).searchParams
  const kind = sp.get('kind') || ''
  const meta = kindByApiKind(kind)
  if (!meta) return NextResponse.json({ error: 'unknown or unsupported kind' }, { status: 400 })

  const namespace = sp.get('namespace') || undefined
  const name = sp.get('name') || undefined
  const base = { clusterId: id, credentialVersion: gate.cluster.credentialVersion, cred: gate.credential }

  if (name) {
    if (meta.scope === 'namespaced' && !namespace) {
      return NextResponse.json({ error: 'namespace required for namespaced detail' }, { status: 400 })
    }
    const r = await getResource({ ...base, kind, namespace, name })
    if (!r.ok) return NextResponse.json({ error: 'orchestrator unreachable' }, { status: 502 })
    return NextResponse.json(r.value, { status: 200 })
  }

  const r = await listResources({ ...base, kind, namespace })
  if (!r.ok) return NextResponse.json({ error: 'orchestrator unreachable' }, { status: 502 })
  return NextResponse.json(r.value, { status: 200 })
}
