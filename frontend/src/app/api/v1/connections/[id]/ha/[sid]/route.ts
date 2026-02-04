import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/ha/{sid}
// Récupère la configuration HA d'une ressource (sid = "vm:100" ou "ct:101")
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    const { id, sid } = await ctx.params
    const conn = await getConnectionById(id)

    const resource = await pveFetch<any>(conn, `/cluster/ha/resources/${encodeURIComponent(sid)}`)

    return NextResponse.json({ data: resource })
  } catch (e: any) {
    // Si la ressource n'existe pas en HA (404, 500 avec "no such resource", ou "does not exist")
    const errorMsg = e?.message || ''

    if (
      errorMsg.includes('404') || 
      errorMsg.includes('does not exist') ||
      errorMsg.includes('no such resource')
    ) {
      return NextResponse.json({ data: null })
    }

    console.error('Error fetching HA resource:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST /api/v1/connections/{id}/ha/{sid}
// Crée ou met à jour la configuration HA d'une ressource
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    const { id, sid } = await ctx.params
    const conn = await getConnectionById(id)
    const body = await req.json()

    // Vérifier si la ressource HA existe déjà
    let exists = false

    try {
      await pveFetch<any>(conn, `/cluster/ha/resources/${encodeURIComponent(sid)}`)
      exists = true
    } catch {
      exists = false
    }

    // Construire les paramètres
    const params = new URLSearchParams()
    
    if (!exists) {
      // Création: sid est requis
      params.append('sid', sid)
    }
    
    if (body.group) params.append('group', body.group)
    if (body.state) params.append('state', body.state)
    if (body.max_restart !== undefined) params.append('max_restart', String(body.max_restart))
    if (body.max_relocate !== undefined) params.append('max_relocate', String(body.max_relocate))
    if (body.comment) params.append('comment', body.comment)

    let result

    if (exists) {
      // PUT pour mettre à jour
      result = await pveFetch<any>(conn, `/cluster/ha/resources/${encodeURIComponent(sid)}`, {
        method: 'PUT',
        body: params.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
    } else {
      // POST pour créer
      result = await pveFetch<any>(conn, '/cluster/ha/resources', {
        method: 'POST',
        body: params.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
    }

    return NextResponse.json({ 
      data: result,
      message: exists ? 'HA configuration updated' : 'HA configuration created'
    })
  } catch (e: any) {
    console.error('Error saving HA resource:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE /api/v1/connections/{id}/ha/{sid}
// Supprime la configuration HA d'une ressource
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; sid: string }> }
) {
  try {
    const { id, sid } = await ctx.params
    const conn = await getConnectionById(id)

    await pveFetch<any>(conn, `/cluster/ha/resources/${encodeURIComponent(sid)}`, {
      method: 'DELETE'
    })

    return NextResponse.json({ 
      data: null,
      message: 'HA configuration removed'
    })
  } catch (e: any) {
    console.error('Error deleting HA resource:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}