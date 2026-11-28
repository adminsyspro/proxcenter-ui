import { NextResponse } from 'next/server'

import { freeDisks } from '@/lib/ceph/freeDisks'
import { sudoAllows } from '@/lib/ceph/detachedPveceph'
import { cephConnection, checkCephWrite, isClusterNode, provisionError } from '@/lib/ceph/provisionRoute'
import { osdCreateArgv } from '@/lib/ceph/pvecephCommands'
import { denyIaasTenantCeph } from '@/lib/ceph/tenantGuard'
import { pveFetch } from '@/lib/proxmox/client'
import { resolveNodeSshEndpoint } from '@/lib/ssh/node-endpoint'
import { assertNodeName } from '@/lib/ssh/validate'

export const runtime = 'nodejs'

/*
   What the Create OSD dialog needs about one node (ui#1450), read when the
   dialog picks the node, never polled: its free disks (one PVE read of
   /nodes/{n}/disks/list) and whether the SSH account may run
   `pveceph osd create` there (one `sudo -n -l`, nothing runs).
*/

type Ctx = { params: Promise<{ id: string; node: string }> }

/** GET /api/v1/connections/[id]/nodes/[node]/ceph/disks → { data: { disks, ssh } } */
export async function GET(_req: Request, ctx: Ctx) {
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

    const gate = await cephConnection(id)
    if (gate.ok === false) return gate.response
    if (!(await isClusterNode(gate.conn, safeNode))) return NextResponse.json({ error: 'Node not found in this connection' }, { status: 404 })

    const disks = freeDisks(await pveFetch<any[]>(gate.conn, `/nodes/${encodeURIComponent(safeNode)}/disks/list`))
    const endpoint = await resolveNodeSshEndpoint(gate.conn, safeNode)
    // Any device stands for the check: the rule pins the shape of the command, not the disk.
    const ssh = await sudoAllows(id, endpoint, osdCreateArgv({ dev: '/dev/sdb' }))

    return NextResponse.json({ data: { disks, ssh } })
  } catch (e: any) {
    return provisionError('disks', e, 'Failed to list the disks of the node')
  }
}
