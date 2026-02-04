import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

type ClusterListItem = {
  id: string
  name: string
  status: "healthy" | "degraded" | "down"
  nodes: number
  nodesOnline: number
  cpuUsagePct: number
  ramUsagePct: number
  isCluster: boolean
}

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10
}

export async function GET() {
  try {
    // 1) Connexions SQLite - uniquement PVE (pas PBS)
    const connections = await prisma.connection.findMany({
      where: { type: 'pve' },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    })

    if (!connections.length) {
      return NextResponse.json(
        { data: [], error: "No PVE connections configured. Create one via POST /api/v1/connections." },
        { status: 200 }
      )
    }

    // 2) Charger toutes les connexions EN PARALLÈLE avec appels directs à PVE
    const allResults: ClusterListItem[] = await Promise.all(
      connections.map(async (c): Promise<ClusterListItem> => {
        try {
          const connData = await getConnectionById(c.id)

          if (!connData.baseUrl || !connData.apiToken) {
            throw new Error("Missing connection config")
          }

          // Charger nodes et cluster/status en parallèle
          const [nodesResult, statusResult] = await Promise.allSettled([
            pveFetch<any[]>(connData, "/nodes"),
            pveFetch<any[]>(connData, "/cluster/status"),
          ])

          const nodes = nodesResult.status === 'fulfilled' ? nodesResult.value || [] : []
          const status = statusResult.status === 'fulfilled' ? statusResult.value || [] : []

          // Extraire le nom du cluster
          const clusterRow = status.find((x: any) => x?.type === "cluster")
          const clusterName = clusterRow?.name || c.name || c.id

          const nodeCount = nodes.length
          const onlineNodes = nodes.filter((n: any) => n.status === 'online').length
          const isCluster = nodeCount > 1

          // Calculer CPU et RAM moyens
          let totalCpu = 0
          let totalMem = 0
          let totalMaxMem = 0

          for (const node of nodes) {
            totalCpu += Number(node.cpu || 0)
            totalMem += Number(node.mem || 0)
            totalMaxMem += Number(node.maxmem || 0)
          }

          const avgCpu = nodeCount > 0 ? round1((totalCpu / nodeCount) * 100) : 0
          const ramPct = totalMaxMem > 0 ? round1((totalMem / totalMaxMem) * 100) : 0

          // Déterminer le status
          let health: "healthy" | "degraded" | "down" = "down"

          if (onlineNodes === nodeCount && nodeCount > 0) {
            health = "healthy"
          } else if (onlineNodes > 0) {
            health = "degraded"
          }

          return {
            id: c.id,
            name: clusterName,
            status: health,
            nodes: nodeCount,
            nodesOnline: onlineNodes,
            cpuUsagePct: avgCpu,
            ramUsagePct: ramPct,
            isCluster,
          }
        } catch (e: any) {
          console.error(`[clusters] failed for ${c.id}:`, e?.message || e)
          
return {
            id: c.id,
            name: c.name ?? c.id,
            status: "down",
            nodes: 0,
            nodesOnline: 0,
            cpuUsagePct: 0,
            ramUsagePct: 0,
            isCluster: false,
          }
        }
      })
    )

    // Filtrer pour ne garder que les vrais clusters (multi-nodes)
    const results = allResults.filter(c => c.isCluster)

    return NextResponse.json({ data: results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
