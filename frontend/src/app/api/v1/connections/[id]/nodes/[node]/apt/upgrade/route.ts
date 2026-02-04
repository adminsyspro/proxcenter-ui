import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/[id]/nodes/[node]/apt/upgrade
 * Lance un apt dist-upgrade sur le node
 * 
 * Proxmox API: POST /nodes/{node}/apt/update (pour refresh) puis apt dist-upgrade via shell
 * Retourne un UPID pour suivre la tâche
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.manage permission pour lancer un upgrade
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Récupérer le type de console demandé
    const body = await req.json().catch(() => ({}))
    const consoleType = body.type || 'xterm'

    // Lancer l'upgrade via l'API Proxmox
    // Note: Proxmox n'a pas d'API directe pour apt upgrade
    // On utilise POST /nodes/{node}/apt/versions pour vérifier les versions
    // puis on lance une commande via le shell ou on utilise l'interface VNC/xterm
    
    // Pour l'instant, on retourne juste les infos pour ouvrir une console
    // L'utilisateur devra lancer apt dist-upgrade manuellement dans la console
    
    // Alternative: utiliser POST /nodes/{node}/termproxy pour créer un terminal
    const termResult = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/termproxy`,
      { 
        method: "POST",
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    )

    return NextResponse.json({ 
      data: {
        ...termResult,
        consoleType,
        node,
        // URL pour accéder à la console
        consoleUrl: `/api/v1/connections/${id}/nodes/${node}/console?type=${consoleType}`
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
