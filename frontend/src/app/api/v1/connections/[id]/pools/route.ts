import { NextResponse } from 'next/server'

import { pveFetch, PveApplicationError } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, getRequestGuestScopePerimeter, PERMISSIONS } from "@/lib/rbac"
import { audit } from '@/lib/audit'
import { invalidateInventoryCache } from '@/lib/cache/inventoryCache'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> | { id: string } }

// Proxmox's `pve-poolid`: starts with a letter, up to three '/'-separated
// levels since PVE 8.1. '.' and '..' segments are refused outright.
const POOLID_RE = /^[A-Za-z][A-Za-z0-9._-]*(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._-]+){0,2}$/

export async function GET(_req: Request, ctx: Ctx) {
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

    // Récupérer la liste des pools - pveFetch retourne directement data
    const pools = await pveFetch<any[]>(conn, '/pools')

    const visiblePools = perimeter?.restricted
      ? (pools || []).filter((p: any) => p?.poolid && perimeter.pools.has(p.poolid))
      : pools || []

    return NextResponse.json({
      data: visiblePools.map((p: any) => ({
        poolid: p.poolid,
        comment: p.comment || null
      })),
      // Tells the provisioning wizards that this list IS the caller's scope,
      // so they surface the pool choice (and drop the "no pool" option) even
      // for a non-admin: their guest has to land in one of these.
      restricted: !!perimeter?.restricted,
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
  const status = e instanceof PveApplicationError && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500

  return NextResponse.json({ error: pveRefusalMessage(e) }, { status })
}

// POST - Create a pool
export async function POST(req: Request, ctx: Ctx) {
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

// PUT - Update a pool's comment
export async function PUT(req: Request, ctx: Ctx) {
  const body = await req.json().catch(() => ({}))
  const r = await resolveWrite(ctx, body?.poolid)

  if ('error' in r) return r.error

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
export async function DELETE(req: Request, ctx: Ctx) {
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
