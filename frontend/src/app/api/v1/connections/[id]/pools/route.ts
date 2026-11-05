import { NextResponse } from 'next/server'
import { licenseExcludedResponse } from '@/lib/api/response'

import { pveFetch, PveApplicationError } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, getRequestGuestScopePerimeter, PERMISSIONS } from "@/lib/rbac"
import { audit } from '@/lib/audit'
import { invalidateInventoryCache } from '@/lib/cache/inventoryCache'
import { refreshCachedGuests } from '@/lib/cache/guestSetRefresh'
import { prisma } from '@/lib/db/prisma'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { withAudit } from '@/lib/audit/withAudit'
import { maskingScope } from '@/lib/tenant/infraScope'
import { denyIaasTenant, resolveCallerInfraScope } from '@/lib/tenant/iaasGuard'
import { iaasPoolsView } from '@/lib/connections/iaasView'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> | { id: string } }

// Proxmox's `pve-poolid`: starts with a letter, up to three '/'-separated
// levels since PVE 8.1. '.' and '..' segments are refused outright.
const POOLID_RE = /^[A-Za-z][A-Za-z0-9._-]*(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._-]+){0,2}$/
// Proxmox's `pve-vmid` and `pve-storage-id`.
const VMID_RE = /^[1-9]\d{2,8}$/
const STORAGE_ID_RE = /^[A-Za-z][A-Za-z0-9._-]*$/

async function getHandler(req: Request, ctx: Ctx) {
  try {
    const params = await Promise.resolve(ctx.params)
    const connId = (params as any)?.id

    if (!connId) return NextResponse.json({ error: 'Missing params.id' }, { status: 400 })

    // A flat-scoped caller (vm/tag/pool) can never satisfy a connection-scoped
    // check, so they used to 403 here and the Create VM wizard showed an empty
    // Resource Pool dropdown (issue #262). Fall back to the guest-derived
    // perimeter: through only if they hold connection.view somewhere AND own a
    // guest on this cluster, and then only their own pools are returned.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", connId)
    const perimeter = denied ? await getRequestGuestScopePerimeter(connId) : null

    if (denied && !(perimeter?.holdsPermission && perimeter.hasVisibleGuests)) return denied

    const conn = await getConnectionById(connId)

    if (!conn) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    // An IaaS tenant only ever sees the pools of its own vDCs on this
    // cluster, never the other customers' (lib/connections/iaasView).
    const caller = await resolveCallerInfraScope()
    if (caller.ok === false) return caller.response
    const vdcScope = maskingScope(caller.infra)

    // Récupérer la liste des pools - pveFetch retourne directement data
    const pools = await pveFetch<any[]>(conn, '/pools')

    let visiblePools = perimeter?.restricted
      ? (pools || []).filter((p: any) => p?.poolid && perimeter.pools.has(p.poolid))
      : pools || []
    if (vdcScope) visiblePools = iaasPoolsView(visiblePools, vdcScope, connId)

    // `?poolid=` reads one pool's members, from the same visible list: a pool
    // the caller cannot list does not exist for them.
    const poolid = new URL(req.url).searchParams.get('poolid')

    if (poolid !== null) {
      const pool = POOLID_RE.test(poolid) ? visiblePools.find((p: any) => p?.poolid === poolid) : null

      if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 })

      return NextResponse.json({ data: { poolid, comment: pool.comment || null, ...poolMembers(await readPoolMembers(conn, poolid)) } })
    }

    return NextResponse.json({
      data: visiblePools.map((p: any) => ({
        poolid: p.poolid,
        comment: p.comment || null
      })),
      // Tells the provisioning wizards that this list IS the caller's scope,
      // so they surface the pool choice (and drop the "no pool" option) even
      // for a non-admin: their guest has to land in one of these.
      restricted: !!perimeter?.restricted || !!vdcScope,
    })
  } catch (error: any) {
    console.error('Error fetching pools:', error)

return NextResponse.json(
      { error: error.message || 'Failed to fetch pools' },
      { status: 500 }
    )
  }
}

/**
 * Shared preamble of the write methods: connection.manage on the connection,
 * a well-formed pool id, and the connection itself.
 */
async function resolveWrite(ctx: Ctx, poolid: unknown) {
  // Pools are the provider's cluster layout: an IaaS tenant never writes them.
  const iaasDenied = await denyIaasTenant()
  if (iaasDenied) return { error: iaasDenied }

  const params = await Promise.resolve(ctx.params)
  const connId = (params as any)?.id

  if (!connId) return { error: NextResponse.json({ error: 'Missing params.id' }, { status: 400 }) }

  const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", connId)

  if (denied) return { error: denied }

  if (typeof poolid !== 'string' || !POOLID_RE.test(poolid)) {
    return { error: NextResponse.json({ error: 'Invalid pool id' }, { status: 400 }) }
  }

  const conn = await getConnectionById(connId)

  if (!conn) return { error: NextResponse.json({ error: 'Connection not found' }, { status: 404 }) }

  return { connId, conn, poolid }
}

/**
 * PVE 8.1 moved pool updates and deletes to `/pools` with `poolid` as a
 * parameter (nested ids carry '/'), and answers 501 on 8.0, which only knows
 * `/pools/{poolid}`. Nested pools do not exist before 8.1, so the fallback
 * only ever serves a flat id.
 */
async function pveWritePool(conn: any, method: 'PUT' | 'DELETE', poolid: string, fields: Record<string, string> = {}) {
  const params = new URLSearchParams({ poolid, ...fields })

  try {
    return method === 'DELETE'
      ? await pveFetch<any>(conn, `/pools?${params.toString()}`, { method })
      : await pveFetch<any>(conn, '/pools', { method, body: params })
  } catch (e) {
    if (!(e instanceof PveApplicationError) || e.statusCode !== 501 || poolid.includes('/')) throw e

    const legacy = `/pools/${encodeURIComponent(poolid)}`

    return method === 'DELETE'
      ? await pveFetch<any>(conn, legacy, { method })
      : await pveFetch<any>(conn, legacy, { method, body: new URLSearchParams(fields) })
  }
}

/**
 * The members of one pool. PVE 8.1 serves them on `/pools?poolid=`; 8.0 does
 * not know the parameter (400, or the plain list back) and only answers on
 * `/pools/{poolid}`, where a nested id cannot exist.
 */
async function readPoolMembers(conn: any, poolid: string): Promise<any[]> {
  try {
    const rows = await pveFetch<any[]>(conn, `/pools?${new URLSearchParams({ poolid }).toString()}`)
    const entry = Array.isArray(rows) ? rows.find((p: any) => p?.poolid === poolid) : null

    if (Array.isArray(entry?.members)) return entry.members
  } catch (e) {
    if (!(e instanceof PveApplicationError) || ![400, 501].includes(e.statusCode)) throw e
  }

  if (poolid.includes('/')) return []

  const legacy = await pveFetch<any>(conn, `/pools/${encodeURIComponent(poolid)}`)

  return Array.isArray(legacy?.members) ? legacy.members : []
}

type PoolStorageMember = { storage: string; type: string | null; shared: boolean; nodes: string[] }

/** Guests as they are, storages once each with the nodes PVE lists them on. */
function poolMembers(members: any[]) {
  const guests = members
    .filter(m => m?.type === 'qemu' || m?.type === 'lxc')
    .map(m => ({ vmid: Number(m.vmid), type: m.type, node: m.node, name: m.name || null, status: m.status || null, template: Boolean(m.template) }))
    .sort((a, b) => a.vmid - b.vmid)
  const storages = new Map<string, PoolStorageMember>()

  for (const m of members) {
    if (m?.type !== 'storage' || !m.storage) continue
    const entry: PoolStorageMember = storages.get(m.storage) ?? { storage: String(m.storage), type: m.plugintype || null, shared: Boolean(m.shared), nodes: [] }

    if (m.node && !entry.nodes.includes(m.node)) entry.nodes.push(m.node)
    storages.set(m.storage, entry)
  }

  return { guests, storages: [...storages.values()].sort((a, b) => a.storage.localeCompare(b.storage)) }
}

type MemberChange = { vms: string[]; storage: string[]; remove: boolean; allowMove: boolean }

/**
 * The membership part of a PUT body, shaped like Proxmox's own call: guests
 * and storages added, or removed with `delete`, in one request. null when the
 * body only carries a comment.
 */
function parseMemberChange(body: any): MemberChange | { error: string } | null {
  if (body?.vms === undefined && body?.storage === undefined) return null

  const list = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v.map(x => String(x).trim()) : null)
  const vms = list(body.vms)
  const storage = list(body.storage)

  if (!vms || !storage) return { error: 'vms and storage must be arrays' }
  if (!vms.length && !storage.length) return { error: 'Nothing to add or remove' }
  if (vms.some(v => !VMID_RE.test(v))) return { error: 'Invalid guest id' }
  if (storage.some(s => !STORAGE_ID_RE.test(s))) return { error: 'Invalid storage id' }

  return {
    vms: [...new Set(vms)],
    storage: [...new Set(storage)],
    remove: body.delete === true,
    allowMove: body.allowMove === true && body.delete !== true,
  }
}

/** The vDCs among these pools of the connection, by pool name. */
async function vdcPools(connId: string, poolids: string[]): Promise<string[]> {
  if (!poolids.length) return []
  const rows = await prisma.vdc.findMany({
    where: { connectionId: connId, pvePoolName: { in: poolids } },
    select: { pvePoolName: true },
  })
  const owned = new Set(rows.map(r => r.pvePoolName))

  return poolids.filter(p => owned.has(p) || p.startsWith('vdc-'))
}

/**
 * A vDC owns its pool's membership: nothing is added to or removed from it
 * here, and no guest is moved out of it by `allow-move` either.
 */
async function vdcMembershipRefusal(connId: string, conn: any, poolid: string, change: MemberChange) {
  if ((await vdcPools(connId, [poolid])).length) {
    return NextResponse.json({ error: 'Pool belongs to a vDC', code: 'POOL_OWNED_BY_VDC' }, { status: 409 })
  }

  if (!change.allowMove || !change.vms.length) return null

  const wanted = new Set(change.vms)
  const rows = await pveFetch<any[]>(conn, '/cluster/resources?type=vm')
  const sources = [...new Set((rows || [])
    .filter(r => wanted.has(String(r?.vmid)) && r?.pool && r.pool !== poolid)
    .map(r => String(r.pool)))]

  if ((await vdcPools(connId, sources)).length) {
    return NextResponse.json({ error: 'A guest belongs to a vDC pool', code: 'GUEST_IN_VDC_POOL' }, { status: 409 })
  }

  return null
}

async function auditPool(action: 'pool.create' | 'pool.update' | 'pool.delete', connId: string, poolid: string, details: Record<string, any>, error?: string) {
  try {
    await audit({
      action,
      category: 'connections',
      resourceType: 'pool',
      resourceId: `${connId}:${poolid}`,
      resourceName: poolid,
      details: { connectionId: connId, ...details },
      status: error ? 'failure' : 'success',
      ...(error ? { errorMessage: error } : {}),
    })
  } catch (auditErr) {
    console.warn(`Failed to write ${action} audit row:`, auditErr)
  }
}

/**
 * Proxmox explains a refusal in its JSON body ("pool 'x' is not empty"),
 * which pveFetch wraps as `PVE <status> <path>: <body>`. The dialog shows
 * that sentence, not the envelope.
 */
function pveRefusalMessage(e: any): string {
  const raw = e?.message || String(e)
  const body = /^PVE \d+ [^:]*: ([\s\S]*)$/.exec(raw)?.[1]

  if (!body) return raw

  try {
    const parsed = JSON.parse(body)
    const detail = parsed?.errors ? Object.values(parsed.errors).join(' ') : ''

    return [parsed?.message, detail].filter(Boolean).join(' ').trim() || raw
  } catch {
    return raw
  }
}

function pveError(e: any) {
  const excluded = licenseExcludedResponse(e)
  if (excluded) return excluded
  const status = e instanceof PveApplicationError && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500

  return NextResponse.json({ error: pveRefusalMessage(e) }, { status })
}

// POST - Create a pool
async function postHandler(req: Request, ctx: Ctx) {
  const body = await req.json().catch(() => ({}))
  const r = await resolveWrite(ctx, body?.poolid)

  if ('error' in r) return r.error

  const comment = typeof body?.comment === 'string' ? body.comment.trim() : ''

  try {
    await pveFetch<any>(r.conn, '/pools', {
      method: 'POST',
      body: new URLSearchParams({ poolid: r.poolid, ...(comment ? { comment } : {}) }),
    })
  } catch (e: any) {
    await auditPool('pool.create', r.connId, r.poolid, { comment }, e?.message || String(e))

    return pveError(e)
  }

  invalidateInventoryCache()
  await auditPool('pool.create', r.connId, r.poolid, { comment })

  return NextResponse.json({ data: { poolid: r.poolid, comment: comment || null } }, { status: 201 })
}

/** Adds guests and storages to a pool, moves guests into it, or removes members. */
async function putMembers(r: { connId: string; conn: any; poolid: string }, change: MemberChange) {
  const refusal = await vdcMembershipRefusal(r.connId, r.conn, r.poolid, change)

  if (refusal) return refusal

  const fields: Record<string, string> = {}

  if (change.vms.length) fields.vms = change.vms.join(',')
  if (change.storage.length) fields.storage = change.storage.join(',')
  if (change.remove) fields.delete = '1'
  if (change.allowMove) fields['allow-move'] = '1'

  const details = { members: change.remove ? 'remove' : 'add', vms: change.vms, storage: change.storage, allowMove: change.allowMove }

  try {
    await pveWritePool(r.conn, 'PUT', r.poolid, fields)
  } catch (e: any) {
    await auditPool('pool.update', r.connId, r.poolid, details, e?.message || String(e))

    return pveError(e)
  }

  // A guest's pool is part of its inventory row: patch the connection in
  // every cached inventory rather than drop them all.
  if (change.vms.length) await refreshCachedGuests(r.connId, r.conn)
  await auditPool('pool.update', r.connId, r.poolid, details)

  return NextResponse.json({ data: { poolid: r.poolid, vms: change.vms.map(Number), storage: change.storage, delete: change.remove } })
}

// PUT - Update a pool's comment, or its members
async function putHandler(req: Request, ctx: Ctx) {
  const body = await req.json().catch(() => ({}))
  const r = await resolveWrite(ctx, body?.poolid)

  if ('error' in r) return r.error

  const change = parseMemberChange(body)

  if (change !== null) {
    if ('error' in change) return NextResponse.json({ error: change.error }, { status: 400 })

    return putMembers(r, change)
  }

  if (typeof body?.comment !== 'string') {
    return NextResponse.json({ error: 'Missing comment' }, { status: 400 })
  }

  // PVE keeps the previous comment when the parameter is absent, so an
  // emptied field is sent as an empty string, which clears it.
  const comment = body.comment.trim()

  try {
    await pveWritePool(r.conn, 'PUT', r.poolid, { comment })
  } catch (e: any) {
    await auditPool('pool.update', r.connId, r.poolid, { comment }, e?.message || String(e))

    return pveError(e)
  }

  invalidateInventoryCache()
  await auditPool('pool.update', r.connId, r.poolid, { comment })

  return NextResponse.json({ data: { poolid: r.poolid, comment: comment || null } })
}

// DELETE - Delete a pool (Proxmox refuses one that still has members)
async function deleteHandler(req: Request, ctx: Ctx) {
  const poolid = new URL(req.url).searchParams.get('poolid')
  const r = await resolveWrite(ctx, poolid)

  if ('error' in r) return r.error

  // A vDC is built on its PVE pool: deleting it from here would leave the
  // vDC pointing at nothing. The vDC's own deletion removes the pool.
  const vdc = await prisma.vdc.findFirst({
    where: { connectionId: r.connId, pvePoolName: r.poolid },
    select: { name: true },
  })

  if (vdc) {
    return NextResponse.json({ error: 'Pool belongs to a vDC', code: 'POOL_OWNED_BY_VDC', vdc: vdc.name }, { status: 409 })
  }

  try {
    await pveWritePool(r.conn, 'DELETE', r.poolid)
  } catch (e: any) {
    await auditPool('pool.delete', r.connId, r.poolid, {}, e?.message || String(e))

    return pveError(e)
  }

  invalidateInventoryCache()
  await auditPool('pool.delete', r.connId, r.poolid, {})

  return NextResponse.json({ data: { success: true } })
}

export const GET = withPublicApiGuard("pools-list", getHandler)
export const POST = withAudit({ category: 'connections', resourceType: 'pool', resourceParam: 'id' }, withPublicApiGuard("pool-create", postHandler))
export const PUT = withAudit({ category: 'connections', resourceType: 'pool', resourceParam: 'id' }, withPublicApiGuard("pool-update", putHandler))
export const DELETE = withAudit({ category: 'connections', resourceType: 'pool', resourceParam: 'id' }, withPublicApiGuard("pool-delete", deleteHandler))
