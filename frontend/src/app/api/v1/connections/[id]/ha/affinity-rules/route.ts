import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/ha/affinity-rules
// Récupère toutes les règles d'affinité HA (PVE 9+)
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

    const rules = await pveFetch<any[]>(conn, '/cluster/ha/rules')

    return NextResponse.json({ data: rules || [] })
  } catch (e: any) {
    // Si l'endpoint n'existe pas (PVE < 9), retourner un tableau vide
    if (e?.message?.includes('404') || e?.message?.includes('not found')) {
      return NextResponse.json({ data: [], unsupported: true })
    }

    console.error('Error fetching HA affinity rules:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST /api/v1/connections/{id}/ha/affinity-rules
// Crée une nouvelle règle d'affinité HA
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
    if (!body.type) {
      return NextResponse.json({ error: 'Le type de règle est requis (node-affinity ou resource-affinity)' }, { status: 400 })
    }

    if (!body.rule) {
      return NextResponse.json({ error: 'Le nom de la règle est requis' }, { status: 400 })
    }

    // Construire les paramètres
    const params = new URLSearchParams()

    params.append('type', body.type) // "node-affinity" ou "resource-affinity"
    params.append('rule', body.rule)
    
    if (body.resources) {
      params.append('resources', body.resources) // Format: "vm:100,ct:101"
    }
    
    // Paramètres spécifiques à node-affinity
    if (body.type === 'node-affinity') {
      if (body.nodes) {
        params.append('nodes', body.nodes) // Format: "node1:1,node2:2" ou "node1,node2"
      }

      if (body.strict !== undefined) {
        params.append('strict', body.strict ? '1' : '0')
      }
    }
    
    // Paramètres spécifiques à resource-affinity
    if (body.type === 'resource-affinity') {
      if (body.affinity) {
        params.append('affinity', body.affinity) // "positive" (keep together) ou "negative" (keep separate)
      }
    }
    
    if (body.state !== undefined) {
      params.append('state', body.state) // "enabled" ou "disabled"
    }

    if (body.comment) {
      params.append('comment', body.comment)
    }

    const result = await pveFetch<any>(conn, '/cluster/ha/rules', {
      method: 'POST',
      body: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })

    return NextResponse.json({ 
      data: result,
      message: 'Règle d\'affinité HA créée avec succès'
    })
  } catch (e: any) {
    console.error('Error creating HA affinity rule:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
