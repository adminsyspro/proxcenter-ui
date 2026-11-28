import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { parsePoolCreate } from '@/lib/ceph/poolForm'
import { cephWriteGate, NO_ONLINE_NODE, onlineCephNode, provisionError } from '@/lib/ceph/provisionRoute'
import { pveFetch } from '@/lib/proxmox/client'

export const runtime = 'nodejs'

/*
   Creation of a replicated Ceph pool (ui#1450), through PVE: an API token may
   create, edit and delete pools (Sys.Modify, plus Datastore.Allocate on
   /storage for add_storages), measured on the lab on 28/11/2026. The answer is
   the task UPID: the dialog follows the task, since the pool can still fail
   there (too many PGs per OSD, a name already taken).
*/

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/connections/[id]/ceph/pools
 * Body: PoolFormInput (lib/ceph/poolForm). Answers { data: { upid, node } }.
 */
async function handlePost(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const gate = await cephWriteGate(id)
    if (gate.ok === false) return gate.response

    const parsed = parsePoolCreate(await req.json().catch(() => ({})))
    if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const node = await onlineCephNode(gate.conn)
    if (!node) return NO_ONLINE_NODE()

    const upid = await pveFetch<string>(gate.conn, `/nodes/${encodeURIComponent(node)}/ceph/pool`, {
      method: 'POST',
      body: new URLSearchParams(parsed.params),
    })
    return NextResponse.json({ data: { upid, node } })
  } catch (e: any) {
    return provisionError('pools', e, 'Failed to create the Ceph pool')
  }
}

export const POST = withAudit(
  { category: 'storage', action: 'ceph_pool_create', resourceType: 'ceph_pool', resourceBodyField: 'name' },
  handlePost,
)
