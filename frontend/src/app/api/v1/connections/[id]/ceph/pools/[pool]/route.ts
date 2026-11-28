import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { isPoolName, parsePoolUpdate } from '@/lib/ceph/poolForm'
import { findPoolGuestDisks } from '@/lib/ceph/poolGuests'
import { cephWriteGate, NO_ONLINE_NODE, onlineCephNode, provisionError } from '@/lib/ceph/provisionRoute'
import { pveFetch } from '@/lib/proxmox/client'

export const runtime = 'nodejs'

/*
   Edit and deletion of one Ceph pool (ui#1450). PVE reads the parameters of a
   DELETE from the query string only: a form body answers 501 "Unexpected
   content for method 'DELETE'" (measured 28/11/2026). A pool whose PVE
   storages still hold guest disks, or whose storages cannot be read, is not
   deleted: no `force`.
*/

type Ctx = { params: Promise<{ id: string; pool: string }> }

const BAD_POOL = () => NextResponse.json({ error: 'Invalid pool name' }, { status: 400 })

/** PUT /api/v1/connections/[id]/ceph/pools/[pool]. Body: the editable fields of PoolFormInput. */
async function handlePut(req: Request, ctx: Ctx) {
  try {
    const { id, pool } = await ctx.params
    if (!isPoolName(pool)) return BAD_POOL()
    const gate = await cephWriteGate(id)
    if (gate.ok === false) return gate.response

    const parsed = parsePoolUpdate(await req.json().catch(() => ({})))
    if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const node = await onlineCephNode(gate.conn)
    if (!node) return NO_ONLINE_NODE()

    const upid = await pveFetch<string>(gate.conn, `/nodes/${encodeURIComponent(node)}/ceph/pool/${encodeURIComponent(pool)}`, {
      method: 'PUT',
      body: new URLSearchParams(parsed.params),
    })
    return NextResponse.json({ data: { upid, node } })
  } catch (e: any) {
    return provisionError('pools', e, 'Failed to update the Ceph pool')
  }
}

/** DELETE /api/v1/connections/[id]/ceph/pools/[pool]?removeStorages=1 */
async function handleDelete(req: Request, ctx: Ctx) {
  try {
    const { id, pool } = await ctx.params
    if (!isPoolName(pool)) return BAD_POOL()
    const gate = await cephWriteGate(id)
    if (gate.ok === false) return gate.response

    const node = await onlineCephNode(gate.conn)
    if (!node) return NO_ONLINE_NODE()

    const guests = await findPoolGuestDisks(gate.conn, node, pool)
    if (guests.disks.length > 0) {
      return NextResponse.json(
        { error: 'The pool still holds guest disks', code: 'POOL_HAS_GUEST_DISKS', disks: guests.disks },
        { status: 409 },
      )
    }
    if (guests.unreadable.length > 0) {
      return NextResponse.json(
        { error: 'The content of a storage of the pool could not be read', code: 'POOL_GUESTS_UNKNOWN', storages: guests.unreadable },
        { status: 409 },
      )
    }

    const removeStorages = new URL(req.url).searchParams.get('removeStorages') === '1'
    const path = `/nodes/${encodeURIComponent(node)}/ceph/pool/${encodeURIComponent(pool)}${removeStorages ? '?remove_storages=1' : ''}`
    const upid = await pveFetch<string>(gate.conn, path, { method: 'DELETE' })
    return NextResponse.json({ data: { upid, node } })
  } catch (e: any) {
    return provisionError('pools', e, 'Failed to delete the Ceph pool')
  }
}

const AUDIT = { category: 'storage', resourceType: 'ceph_pool', resourceParam: 'pool' } as const

export const PUT = withAudit({ ...AUDIT, action: 'ceph_pool_update' }, handlePut)
export const DELETE = withAudit({ ...AUDIT, action: 'ceph_pool_delete' }, handleDelete)
