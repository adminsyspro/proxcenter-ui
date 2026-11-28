import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { parseInitBody } from '@/lib/ceph/initForm'
import { cephConnection, checkCephWrite, isClusterNode, provisionError } from '@/lib/ceph/provisionRoute'
import { denyIaasTenantCeph } from '@/lib/ceph/tenantGuard'
import { pveFetch } from '@/lib/proxmox/client'
import { getSessionPrisma } from '@/lib/tenant'

export const runtime = 'nodejs'

/*
   Initialization of Ceph on a cluster (ui#1450), through PVE: an API token may
   run `POST /nodes/{n}/ceph/init` (Sys.Modify). It writes the cluster-wide
   /etc/pve/ceph.conf and returns at once; then the first monitor, whose task
   creates the first manager too (PVE/API2/Ceph/MON.pm). The answer is that
   task's UPID, followed by the wizard. Once init went through, the
   connection is flagged as running Ceph, so the cockpit lists it without a
   manual re-detection.
*/

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/v1/connections/[id]/ceph/init, body { node, network, clusterNetwork?, size, minSize } */
async function handlePost(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const denied = await checkCephWrite(id)
    if (denied) return denied
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    const parsed = parseInitBody(await req.json().catch(() => ({})))
    if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const gate = await cephConnection(id)
    if (gate.ok === false) return gate.response
    const { node, fields } = parsed.params
    if (!(await isClusterNode(gate.conn, node))) return NextResponse.json({ error: 'Node not found in this connection' }, { status: 404 })

    const base = `/nodes/${encodeURIComponent(node)}/ceph`
    await pveFetch(gate.conn, `${base}/init`, { method: 'POST', body: new URLSearchParams(fields) })

    const prisma = await getSessionPrisma()
    await prisma.connection.update({ where: { id }, data: { hasCeph: true } })

    const upid = await pveFetch<string>(gate.conn, `${base}/mon/${encodeURIComponent(node)}`, { method: 'POST', body: new URLSearchParams() })
    return NextResponse.json({ data: { upid, node, hasCeph: true } })
  } catch (e: any) {
    return provisionError('init', e, 'Failed to initialize Ceph')
  }
}

export const POST = withAudit({ category: 'storage', resourceType: 'connection', resourceParam: 'id', action: 'ceph_init' }, handlePost)
