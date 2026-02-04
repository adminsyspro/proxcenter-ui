import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/ha/groups/{groupId}
// Récupère un groupe HA spécifique
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { id, groupId } = await ctx.params

    // Vérifier la permission de voir la connexion
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)

    if (permError) return permError

    const conn = await getConnectionById(id)

    const group = await pveFetch<any>(conn, `/cluster/ha/groups/${encodeURIComponent(groupId)}`)

    return NextResponse.json({ data: group })
  } catch (e: any) {
    if (e?.message?.includes('404') || e?.message?.includes('does not exist')) {
      return NextResponse.json({ error: 'Groupe HA non trouvé' }, { status: 404 })
    }

    console.error('Error fetching HA group:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/connections/{id}/ha/groups/{groupId}
// Met à jour un groupe HA
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { id, groupId } = await ctx.params

    // Vérifier la permission de gérer la connexion
    const permError = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

    if (permError) return permError

    const conn = await getConnectionById(id)
    const body = await req.json()

    // Construire les paramètres
    const params = new URLSearchParams()
    
    if (body.nodes) {
      params.append('nodes', body.nodes)
    }

    if (body.restricted !== undefined) {
      params.append('restricted', body.restricted ? '1' : '0')
    }

    if (body.nofailback !== undefined) {
      params.append('nofailback', body.nofailback ? '1' : '0')
    }

    if (body.comment !== undefined) {
      params.append('comment', body.comment)
    }


    // Pour supprimer un champ, on utilise 'delete'
    if (body.delete) {
      params.append('delete', body.delete)
    }

    const result = await pveFetch<any>(conn, `/cluster/ha/groups/${encodeURIComponent(groupId)}`, {
      method: 'PUT',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    return NextResponse.json({ 
      data: result,
      message: 'Groupe HA mis à jour avec succès'
    })
  } catch (e: any) {
    console.error('Error updating HA group:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE /api/v1/connections/{id}/ha/groups/{groupId}
// Supprime un groupe HA
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { id, groupId } = await ctx.params

    // Vérifier la permission de gérer la connexion
    const permError = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

    if (permError) return permError

    const conn = await getConnectionById(id)

    await pveFetch<any>(conn, `/cluster/ha/groups/${encodeURIComponent(groupId)}`, {
      method: 'DELETE'
    })

    return NextResponse.json({ 
      data: null,
      message: 'Groupe HA supprimé avec succès'
    })
  } catch (e: any) {
    console.error('Error deleting HA group:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
