import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id

  if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

  // RBAC: Check node.view permission
  const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", id)

  if (denied) return denied

  const conn = await getConnectionById(id)
  const nodes = await pveFetch<any[]>(conn, `/nodes`, { method: "GET" })

  // Enrichir chaque node avec son IP
  const enrichedNodes = await Promise.all(
    (nodes || []).map(async (node: any) => {
      const nodeName = node.node || node.name

      if (!nodeName) return node

      let ip: string | null = null

      try {
        // Récupérer les interfaces réseau du node
        const networks = await pveFetch<any[]>(
          conn,
          `/nodes/${encodeURIComponent(nodeName)}/network`
        )

        if (Array.isArray(networks)) {
          // Chercher l'IP sur les interfaces principales (vmbr0, eth0, ens18, etc.)
          for (const iface of networks) {
            const ifaceName = (iface.iface || '').toLowerCase()


            // Priorité aux bridges et interfaces physiques
            if (ifaceName.startsWith('vmbr') || ifaceName.startsWith('eth') || ifaceName.startsWith('ens') || ifaceName.startsWith('enp')) {
              if (iface.address && !iface.address.startsWith('127.')) {
                ip = iface.address
                break
              }
            }
          }


          // Fallback: prendre la première IP non-loopback
          if (!ip) {
            for (const iface of networks) {
              if (iface.address && !iface.address.startsWith('127.')) {
                ip = iface.address
                break
              }
            }
          }
        }
      } catch {
        // Pas d'accès aux interfaces réseau
      }

      return {
        ...node,
        ip
      }
    })
  )

  return NextResponse.json({ data: enrichedNodes })
}
