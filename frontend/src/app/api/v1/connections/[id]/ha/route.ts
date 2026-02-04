import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/ha
// Récupère les ressources HA, les groupes HA (PVE 8) ou les règles d'affinité (PVE 9)
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

    // Récupérer les ressources HA, les groupes et les règles en parallèle
    const [resourcesResult, groupsResult, rulesResult, versionResult] = await Promise.allSettled([
      pveFetch<any[]>(conn, '/cluster/ha/resources'),
      pveFetch<any[]>(conn, '/cluster/ha/groups'),
      pveFetch<any[]>(conn, '/cluster/ha/rules'), // PVE 9+ uniquement
      pveFetch<any>(conn, '/version'),
    ])

    const resources = resourcesResult.status === 'fulfilled' ? resourcesResult.value || [] : []
    const groups = groupsResult.status === 'fulfilled' ? groupsResult.value || [] : []
    
    // Vérifier si les règles sont supportées (PVE 9+)
    const rulesSupported = rulesResult.status === 'fulfilled'
    const rules = rulesSupported ? rulesResult.value || [] : []
    
    // Extraire la version de PVE
    let pveVersion = '8.0.0'

    if (versionResult.status === 'fulfilled' && versionResult.value) {
      pveVersion = versionResult.value.version || versionResult.value.release || '8.0.0'
    }
    
    // Déterminer la version majeure (8 ou 9)
    const majorVersion = parseInt(pveVersion.split('.')[0], 10) || 8

    return NextResponse.json({
      data: {
        resources,
        groups,
        rules,
        pveVersion,
        majorVersion,
        rulesSupported, // true si PVE 9+
      }
    })
  } catch (e: any) {
    console.error('Error fetching HA:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
