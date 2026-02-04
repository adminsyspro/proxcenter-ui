import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  
return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function secondsToUptime(seconds: number) {
  if (!seconds || seconds < 0) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)

  if (d > 0) return `${d}j ${h}h`
  if (h > 0) return `${h}h ${m}m`
  
return `${m}m`
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const connIdFilter = url.searchParams.get('connId')

    const connections = await prisma.connection.findMany({
      where: { type: 'pve' },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    })

    if (!connections.length) {
      return NextResponse.json({ data: { hosts: [], stats: { total: 0, online: 0, offline: 0 } } })
    }

    const targetConnections = connIdFilter && connIdFilter !== '*'
      ? connections.filter(c => c.id === connIdFilter)
      : connections

    const connectionPromises = targetConnections.map(async (conn) => {
      try {
        const connData = await getConnectionById(conn.id)

        if (!connData.baseUrl || !connData.apiToken) return []

        // Optimisation: utiliser /cluster/resources qui contient tout en une seule requête
        // au lieu de faire N appels à /nodes/{node}/status
        const resources = await pveFetch<any[]>(connData, "/cluster/resources")
        
        const nodes = resources.filter((r: any) => r?.type === 'node')
        const isCluster = nodes.length > 1

        const nodeDetails = nodes.map((node: any) => {
          if (!node?.node) return null

          const cpuUsage = Number(node.cpu || 0)
          const memUsed = Number(node.mem || 0)
          const memMax = Number(node.maxmem || 0)
          const diskUsed = Number(node.disk || 0)
          const diskMax = Number(node.maxdisk || 0)
          const uptime = Number(node.uptime || 0)

          return {
            id: `${conn.id}:${node.node}`,
            connId: conn.id,
            connectionName: conn.name,
            scope: isCluster ? 'cluster' : 'standalone',
            node: node.node,
            status: node.status || 'unknown',
            cpu: round1(cpuUsage * 100),
            cpuCores: 0, // Non disponible dans /cluster/resources
            ram: memMax > 0 ? round1((memUsed / memMax) * 100) : 0,
            ramUsed: memUsed,
            ramMax: memMax,
            ramUsedFormatted: formatBytes(memUsed),
            ramMaxFormatted: formatBytes(memMax),
            disk: diskMax > 0 ? round1((diskUsed / diskMax) * 100) : 0,
            diskUsed,
            diskMax,
            diskUsedFormatted: formatBytes(diskUsed),
            diskMaxFormatted: formatBytes(diskMax),
            uptime,
            uptimeFormatted: secondsToUptime(uptime),
          }
        })

        return nodeDetails.filter((n): n is NonNullable<typeof n> => n !== null)
      } catch (e) {
        console.error(`[hosts] Error fetching connection ${conn.id}:`, e)
        
return []
      }
    })

    const results = await Promise.all(connectionPromises)
    const allHosts = results.flat()

    allHosts.sort((a, b) => a.node.localeCompare(b.node))

    return NextResponse.json({
      data: {
        hosts: allHosts,
        stats: {
          total: allHosts.length,
          online: allHosts.filter(h => h.status === 'online').length,
          offline: allHosts.filter(h => h.status !== 'online').length,
        }
      }
    })
  } catch (e: any) {
    console.error("[hosts] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
