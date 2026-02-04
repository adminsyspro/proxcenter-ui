import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/{id}/fingerprint
 * 
 * Récupère le fingerprint TLS du cluster Proxmox.
 * Utilisé pour la migration cross-cluster.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    if (!id) {
      return NextResponse.json({ error: "Missing connection id" }, { status: 400 })
    }

    const conn = await getConnectionById(id)
    
    let fingerprint = ''
    let source = ''
    let nodeName = ''

    // Méthode 1: Essayer /cluster/config/join (cluster)
    try {
      const joinInfo = await pveFetch<any>(conn, "/cluster/config/join")
      
      if (joinInfo?.fingerprint) {
        fingerprint = joinInfo.fingerprint
        source = 'cluster/config/join'
      } else if (joinInfo?.nodelist?.[0]?.pve_fp) {
        fingerprint = joinInfo.nodelist[0].pve_fp
        nodeName = joinInfo.nodelist[0].name || ''
        source = 'cluster/config/join (nodelist)'
      }
    } catch {
      // Pas un cluster ou pas d'accès
    }
    
    // Méthode 2: Essayer /cluster/config/nodes
    if (!fingerprint) {
      try {
        const configNodes = await pveFetch<any[]>(conn, "/cluster/config/nodes")
        if (configNodes && configNodes.length > 0) {
          // Prendre le premier node avec un fingerprint
          const nodeWithFp = configNodes.find((n: any) => n.pve_fp)
          if (nodeWithFp) {
            fingerprint = nodeWithFp.pve_fp
            nodeName = nodeWithFp.name || ''
            source = 'cluster/config/nodes'
          }
        }
      } catch {
        // Ignorer
      }
    }

    // Méthode 3: Pour un standalone, essayer de récupérer via pvenode cert info
    // (Note: cela nécessite un accès shell, donc on ne peut pas le faire via API)
    
    if (!fingerprint) {
      // On peut essayer de récupérer le certificat directement via HTTPS
      // Mais c'est compliqué côté serveur Node.js
      // Pour l'instant, retourner une erreur explicative
    }

    // Extraire l'host de la connexion
    const url = new URL(conn.baseUrl)
    const host = url.hostname
    const port = url.port || '8006'

    return NextResponse.json({
      data: {
        fingerprint,
        source,
        nodeName,
        host,
        port,
        connectionName: conn.name,
        // Format prêt à l'emploi pour remote_migrate
        targetEndpointFormat: fingerprint 
          ? `apitoken=PVEAPIToken=***,host=${host}${port !== '8006' ? `,port=${port}` : ''},fingerprint=${fingerprint}`
          : `apitoken=PVEAPIToken=***,host=${host}${port !== '8006' ? `,port=${port}` : ''}`
      }
    })

  } catch (e: any) {
    console.error('[fingerprint] Error:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
