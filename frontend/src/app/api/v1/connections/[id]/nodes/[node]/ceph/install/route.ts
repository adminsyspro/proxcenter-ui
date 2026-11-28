import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { installStatus } from '@/lib/ceph/deployPreflight'
import { detachedOutput, installRunning, readDetachedLog, runDetached } from '@/lib/ceph/detachedPveceph'
import { cephConnection, checkCephWrite, isClusterNode, prepareCephSsh, provisionError } from '@/lib/ceph/provisionRoute'
import { installArgv, parseCephInstall } from '@/lib/ceph/pvecephCommands'
import { denyIaasTenantCeph } from '@/lib/ceph/tenantGuard'
import { resolveNodeSshEndpoint } from '@/lib/ssh/node-endpoint'
import { assertNodeName } from '@/lib/ssh/validate'

export const runtime = 'nodejs'

/*
   Installation of the Ceph packages on one node (ui#1450). PVE has no API for
   it: `pveceph install --version <v> --repository <r>` runs over SSH under the
   pinned rule ui-ceph-install of the ceph-provisioning sudo profile, detached
   (apt takes minutes, a route may not last past 60 s), its output in the SSH
   account's log. With --version given and no terminal, pveceph asks nothing
   itself (PVE/CLI/pveceph.pm), but its `apt-get install` has no -y: the run
   answers yes on its input. GET polls that log. ProxCenter never rewrites the
   node's apt sources: a repository answering 401 ends the run with apt's line.
*/

type Ctx = { params: Promise<{ id: string; node: string }> }
const TAG = 'ceph-install'

function nodeOf(raw: string): string | null {
  try {
    return assertNodeName(raw)
  } catch {
    return null
  }
}

/** POST .../ceph/install, body { version, repository } → { data: { started, node } } */
async function handlePost(req: Request, ctx: Ctx) {
  try {
    const { id, node } = await ctx.params
    const safeNode = nodeOf(node)
    if (!safeNode) return NextResponse.json({ error: 'Invalid node name' }, { status: 400 })
    const denied = await checkCephWrite(id)
    if (denied) return denied
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied

    const parsed = parseCephInstall(await req.json().catch(() => ({})))
    if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const gate = await cephConnection(id)
    if (gate.ok === false) return gate.response
    if (!(await isClusterNode(gate.conn, safeNode))) return NextResponse.json({ error: 'Node not found in this connection' }, { status: 404 })

    const argv = installArgv(parsed.params.version, parsed.params.repository)
    const ssh = await prepareCephSsh(id, gate.conn, safeNode, argv)
    if (ssh.ok === false) return ssh.response
    if (await installRunning(id, ssh.endpoint)) {
      return NextResponse.json({ error: 'A Ceph installation is already running on this node', code: 'INSTALL_RUNNING' }, { status: 409 })
    }
    const started = await runDetached(id, ssh.endpoint, argv, TAG, { answerYes: true })
    if ('error' in started) return NextResponse.json({ error: started.error, code: 'SSH_FAILED' }, { status: 502 })
    return NextResponse.json({ data: { started: true, node: safeNode } })
  } catch (e: any) {
    return provisionError('install', e, 'Failed to start the Ceph installation')
  }
}

/** GET .../ceph/install → { data: { status, logs } } */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id, node } = await ctx.params
    const safeNode = nodeOf(node)
    if (!safeNode) return NextResponse.json({ error: 'Invalid node name' }, { status: 400 })
    const denied = await checkCephWrite(id)
    if (denied) return denied
    const cephDenied = await denyIaasTenantCeph()
    if (cephDenied) return cephDenied
    const gate = await cephConnection(id)
    if (gate.ok === false) return gate.response
    if (!(await isClusterNode(gate.conn, safeNode))) return NextResponse.json({ error: 'Node not found in this connection' }, { status: 404 })

    const log = await readDetachedLog(id, await resolveNodeSshEndpoint(gate.conn, safeNode), TAG)
    return NextResponse.json({ data: { status: installStatus(log), logs: log === null ? '' : detachedOutput(log, 40) } })
  } catch (e: any) {
    return provisionError('install', e, 'Failed to read the Ceph installation')
  }
}

export const POST = withAudit({ category: 'nodes', resourceType: 'node', resourceParam: 'node', action: 'ceph_install' }, handlePost)
