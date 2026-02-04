import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// Helper pour formater les données de subscription
function formatSubscriptionData(subscription: any) {
  // checktime est un timestamp unix (nombre de secondes)
  // regdate est une string date comme "2026-02-01 04:50:05"
  let lastCheckedFormatted: string | null = null
  
  if (subscription?.checktime) {
    // C'est un timestamp unix en secondes
    const ts = typeof subscription.checktime === 'number' ? subscription.checktime : parseInt(subscription.checktime)
    if (!isNaN(ts)) {
      lastCheckedFormatted = new Date(ts * 1000).toISOString()
    }
  }
  
  return {
    status: subscription?.status || 'unknown',
    type: subscription?.productname || 'Unknown',
    key: subscription?.key || null,
    serverId: subscription?.serverid || null,
    sockets: subscription?.sockets || null,
    lastChecked: lastCheckedFormatted, // ISO string ou null
    nextDueDate: subscription?.nextduedate || null,
    level: subscription?.level || null,
    url: subscription?.url || null,
    regdate: subscription?.regdate || null,
  }
}

/**
 * GET /api/v1/connections/[id]/nodes/[node]/subscription
 * Récupère le statut de la subscription Proxmox pour un node
 * 
 * Proxmox API: GET /nodes/{node}/subscription
 * Retourne: { status, serverid, sockets, key, regdate, nextduedate, productname, ... }
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.view permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Proxmox: GET /nodes/{node}/subscription
    const subscription = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/subscription`,
      { method: "GET" }
    )

    return NextResponse.json({ data: formatSubscriptionData(subscription) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/subscription
 * Force une vérification de la subscription auprès des serveurs Proxmox
 * 
 * Proxmox API: POST /nodes/{node}/subscription
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.manage permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Proxmox: POST /nodes/{node}/subscription
    // Force une vérification de la subscription
    await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/subscription`,
      { 
        method: "POST",
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    )

    // Récupérer les nouvelles données
    const subscription = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/subscription`,
      { method: "GET" }
    )

    return NextResponse.json({ data: formatSubscriptionData(subscription) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PUT /api/v1/connections/[id]/nodes/[node]/subscription
 * Upload/Update une clé de subscription
 * 
 * Proxmox API: PUT /nodes/{node}/subscription
 * Body: { key: "pve2c-..." }
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const body = await req.json()
    const { key } = body

    if (!key) {
      return NextResponse.json({ error: "Subscription key is required" }, { status: 400 })
    }

    // RBAC: Check node.manage permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Proxmox: PUT /nodes/{node}/subscription
    await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/subscription`,
      { 
        method: "PUT",
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `key=${encodeURIComponent(key)}`
      }
    )

    // Récupérer les nouvelles données
    const subscription = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/subscription`,
      { method: "GET" }
    )

    return NextResponse.json({ data: formatSubscriptionData(subscription) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/connections/[id]/nodes/[node]/subscription
 * Supprime la subscription
 * 
 * Proxmox API: DELETE /nodes/{node}/subscription
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.manage permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Proxmox: DELETE /nodes/{node}/subscription
    await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/subscription`,
      { method: "DELETE" }
    )

    // Récupérer les nouvelles données (devrait être vide/notfound)
    const subscription = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/subscription`,
      { method: "GET" }
    )

    return NextResponse.json({ data: formatSubscriptionData(subscription) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
