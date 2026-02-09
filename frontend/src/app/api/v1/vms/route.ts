import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getRBACContext, filterVmsByPermission, PERMISSIONS } from "@/lib/rbac"
import { formatBytes, formatUptime } from "@/utils/format"

export const runtime = "nodejs"

/**
 * GET /api/v1/vms
 *
 * API agrégée qui retourne toutes les VMs et LXCs de toutes les connexions PVE.
 * Optimisé pour charger toutes les données en parallèle.
 * Les IPs sont chargées séparément via /api/v1/vms/ips pour ne pas ralentir.
 */

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const connIdFilter = url.searchParams.get('connId')

    // Récupérer les connexions PVE
    const connections = await prisma.connection.findMany({
      where: { type: 'pve' },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    })

    if (!connections.length) {
      return NextResponse.json({
        data: {
          vms: [],
          stats: { total: 0, running: 0, stopped: 0, paused: 0 }
        }
      })
    }

    // Filtrer si nécessaire
    const targetConnections = connIdFilter && connIdFilter !== '*'
      ? connections.filter(c => c.id === connIdFilter)
      : connections

    // Charger toutes les connexions EN PARALLÈLE
    const connectionPromises = targetConnections.map(async (conn) => {
      try {
        const connData = await getConnectionById(conn.id)

        if (!connData.baseUrl || !connData.apiToken) return []

        // Charger cluster/resources et nodes en parallèle
        const [resourcesResult, nodesResult] = await Promise.allSettled([
          pveFetch<any[]>(connData, "/cluster/resources?type=vm"),
          pveFetch<any[]>(connData, "/nodes"),
        ])

        const resources = resourcesResult.status === 'fulfilled' ? resourcesResult.value || [] : []
        const nodes = nodesResult.status === 'fulfilled' ? nodesResult.value || [] : []
        
        const isCluster = nodes.length > 1

        // Transformer les resources en format attendu
        return resources.map((r: any) => {
          const cpuPct = round1(Number(r.cpu || 0) * 100)
          const ramPct = r.maxmem ? round1((Number(r.mem || 0) / Number(r.maxmem)) * 100) : 0

          return {
            id: `${conn.id}:${r.type}:${r.node}:${r.vmid}`,
            connId: conn.id,
            connectionName: conn.name,
            scope: isCluster ? 'cluster' : 'standalone',
            type: r.type || 'qemu',
            node: r.node || '',
            host: r.node || '-',
            vmid: String(r.vmid || r.id || ''),
            name: r.name || `${r.type}/${r.vmid}`,
            status: r.status || 'unknown',
            cpu: cpuPct,
            ram: ramPct,
            ramUsed: Number(r.mem || 0),
            ramMax: Number(r.maxmem || 0),
            maxmem: Number(r.maxmem || 0),
            maxdisk: Number(r.maxdisk || 0),
            ramUsedFormatted: formatBytes(Number(r.mem || 0)),
            ramMaxFormatted: formatBytes(Number(r.maxmem || 0)),
            diskGb: round1(Number(r.maxdisk || 0) / 1073741824),
            uptime: formatUptime(r.uptime),
            uptimeSeconds: Number(r.uptime || 0),
            template: r.template === 1,
            tags: r.tags ? String(r.tags).split(';').filter(Boolean) : [],
            pool: r.pool || null,
            netvmid: r.netvmid,
            ip: null, // Chargé séparément via /api/v1/vms/ips
          }
        })
      } catch (e) {
        console.error(`[vms] Error fetching connection ${conn.id}:`, e)
        
return []
      }
    })

    const results = await Promise.all(connectionPromises)
    let allVms = results.flat()

    // RBAC: Filtrer les VMs selon les permissions
    const rbacCtx = await getRBACContext()

    if (rbacCtx && !rbacCtx.isAdmin) {
      allVms = filterVmsByPermission(rbacCtx.userId, allVms, PERMISSIONS.VM_VIEW)
    }

    // Trier par vmid
    allVms.sort((a, b) => {
      const aId = parseInt(a.vmid, 10) || 0
      const bId = parseInt(b.vmid, 10) || 0

      
return aId - bId
    })

    // Stats
    const stats = {
      total: allVms.length,
      running: allVms.filter(v => v.status === 'running').length,
      stopped: allVms.filter(v => v.status === 'stopped').length,
      paused: allVms.filter(v => v.status === 'paused').length,
      templates: allVms.filter(v => v.template).length,
      qemu: allVms.filter(v => v.type === 'qemu').length,
      lxc: allVms.filter(v => v.type === 'lxc').length,
    }

    return NextResponse.json({
      data: {
        vms: allVms,
        stats,
      }
    })
  } catch (e: any) {
    console.error("[vms] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
