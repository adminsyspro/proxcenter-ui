import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/ha/affinity-rules/{ruleId}
// Récupère une règle d'affinité HA spécifique
async function getHandler(
  req: Request,
  ctx: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    const { id, ruleId } = await ctx.params

    // Vérifier la permission de voir la connexion
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)

    if (permError) return permError

    const conn = await getConnectionById(id)

    const rule = await pveFetch<any>(conn, `/cluster/ha/rules/${encodeURIComponent(ruleId)}`)

    return NextResponse.json({ data: rule })
  } catch (e: any) {
    if (e?.message?.includes('404') || e?.message?.includes('does not exist')) {
      return NextResponse.json({ error: 'Règle d\'affinité HA non trouvée' }, { status: 404 })
    }

    console.error('Error fetching HA affinity rule:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT /api/v1/connections/{id}/ha/affinity-rules/{ruleId}
// Met à jour une règle d'affinité HA
async function putHandler(
  req: Request,
  ctx: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    const { id, ruleId } = await ctx.params

    // Vérifier la permission de gérer la connexion
    const permError = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

    if (permError) return permError

    const conn = await getConnectionById(id)
    const body = await req.json()

    // Construire les paramètres
    const params = new URLSearchParams()
    
    if (body.resources !== undefined) {
      params.append('resources', body.resources)
    }
    
    // Paramètres spécifiques à node-affinity
    if (body.nodes !== undefined) {
      params.append('nodes', body.nodes)
    }

    if (body.strict !== undefined) {
      params.append('strict', body.strict ? '1' : '0')
    }
    
    // Paramètres spécifiques à resource-affinity
    if (body.affinity !== undefined) {
      params.append('affinity', body.affinity)
    }
    
    if (body.disable !== undefined) {
      params.append('disable', body.disable ? '1' : '0')
    }

    if (body.comment !== undefined) {
      params.append('comment', body.comment)
    }
    
    // Pour supprimer un champ, on utilise 'delete'
    if (body.delete) {
      params.append('delete', body.delete)
    }
    
    // Digest pour vérification de concurrence (optionnel)
    if (body.digest) {
      params.append('digest', body.digest)
    }

    const result = await pveFetch<any>(conn, `/cluster/ha/rules/${encodeURIComponent(ruleId)}`, {
      method: 'PUT',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    return NextResponse.json({ 
      data: result,
      message: 'Règle d\'affinité HA mise à jour avec succès'
    })
  } catch (e: any) {
    console.error('Error updating HA affinity rule:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE /api/v1/connections/{id}/ha/affinity-rules/{ruleId}
// Supprime une règle d'affinité HA
async function deleteHandler(
  req: Request,
  ctx: { params: Promise<{ id: string; ruleId: string }> }
) {
  try {
    const { id, ruleId } = await ctx.params

    // Vérifier la permission de gérer la connexion
    const permError = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

    if (permError) return permError

    const conn = await getConnectionById(id)

    await pveFetch<any>(conn, `/cluster/ha/rules/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE'
    })

    return NextResponse.json({ 
      data: null,
      message: 'Règle d\'affinité HA supprimée avec succès'
    })
  } catch (e: any) {
    console.error('Error deleting HA affinity rule:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("ha-affinity-get", getHandler)
export const PUT = withPublicApiGuard("ha-affinity-update", putHandler)
export const DELETE = withPublicApiGuard("ha-affinity-delete", deleteHandler)
