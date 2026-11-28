import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { cephConnection, checkCephWrite, isClusterNode, prepareCephSsh, provisionError, pvecephTag, runPvecephTask } from '@/lib/ceph/provisionRoute'
import { osdCreateArgv, parseOsdCreate } from '@/lib/ceph/pvecephCommands'
import { denyIaasTenantCeph } from '@/lib/ceph/tenantGuard'
import { assertNodeName } from '@/lib/ssh/validate'

export const runtime = 'nodejs'

/*
   Creation of an OSD on a free disk of the node (ui#1450). PVE keeps
   `POST /nodes/{n}/ceph/osd` to root@pam logged in with a password: an API
   token gets "Permission check failed (user != root@pam)" (measured on PVE
   9.2). So pveceph runs over SSH on the node, detached, under the pinned rule
   ui-ceph-osd-create of the ceph-provisioning sudo profile; nothing runs when
   the SSH account may not run that exact command.
*/

type Ctx = { params: Promise<{ id: string; node: string }> }

/**
 * POST /api/v1/connections/[id]/nodes/[node]/ceph/osd
 * Body: OsdCreateInput (lib/ceph/pvecephCommands). Answers { data: { upid, node } },
 * 202 { data: { pending, node } }, or an error with its code.
 */
async function handlePost(req: Request, ctx: Ctx) {
  try {
    const { id, node } = await ctx.params
    let safeNode: string
    try {
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: 'Invalid node name' }, { status: 400 })
    }

    const denied = await checkCephWrite(id)
    if (denied) return denied
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    const parsed = parseOsdCreate(await req.json().catch(() => ({})))
    if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const gate = await cephConnection(id)
    if (gate.ok === false) return gate.response
    if (!(await isClusterNode(gate.conn, safeNode))) return NextResponse.json({ error: 'Node not found in this connection' }, { status: 404 })

    const argv = osdCreateArgv(parsed.params)
    const ssh = await prepareCephSsh(id, gate.conn, safeNode, argv)
    if (ssh.ok === false) return ssh.response

    const devName = parsed.params.dev.replace(/^\/dev\//, '')
    return await runPvecephTask(id, gate.conn, safeNode, ssh.endpoint, argv, {
      tag: pvecephTag('ceph-osd-create', devName),
      taskType: 'cephcreateosd',
      taskId: devName,
    })
  } catch (e: any) {
    return provisionError('osd', e, 'Failed to create the OSD')
  }
}

export const POST = withAudit({ category: 'nodes', resourceType: 'node', resourceParam: 'node', action: 'ceph_osd_create' }, handlePost)
