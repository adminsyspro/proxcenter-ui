import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/ha/groups
// Récupère tous les groupes HA
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    // Vérifier la permission de voir la connexion
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)

    if (permError) return permError

    const conn = await getConnectionById(id)

    const groups = await pveFetch<any[]>(conn, '/cluster/ha/groups')

    return NextResponse.json({ data: groups || [] })
  } catch (e: any) {
    console.error('Error fetching HA groups:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST /api/v1/connections/{id}/ha/groups
// Crée un nouveau groupe HA
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    // Vérifier la permission de gérer la connexion
    const permError = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

    if (permError) return permError

    const conn = await getConnectionById(id)
    const body = await req.json()

    // Valider les paramètres requis
    if (!body.group) {
      return NextResponse.json({ error: 'Le nom du groupe est requis' }, { status: 400 })
    }

    if (!body.nodes) {
      return NextResponse.json({ error: 'Les nœuds sont requis' }, { status: 400 })
    }

    // Construire les paramètres
    const params = new URLSearchParams()

    params.append('group', body.group)
    params.append('nodes', body.nodes) // Format: "node1:1,node2:2" ou "node1,node2"
    
    if (body.restricted !== undefined) {
      params.append('restricted', body.restricted ? '1' : '0')
    }

    if (body.nofailback !== undefined) {
      params.append('nofailback', body.nofailback ? '1' : '0')
    }

    if (body.comment) {
      params.append('comment', body.comment)
    }

    const result = await pveFetch<any>(conn, '/cluster/ha/groups', {
      method: 'POST',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    return NextResponse.json({ 
      data: result,
      message: 'Groupe HA créé avec succès'
    })
  } catch (e: any) {
    console.error('Error creating HA group:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
