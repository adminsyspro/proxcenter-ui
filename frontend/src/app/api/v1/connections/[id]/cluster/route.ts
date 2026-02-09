import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"

export const runtime = "nodejs"

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const conn = await getConnectionById(id)

    // Guard explicite (évite le .replace undefined)
    if (!conn.baseUrl) {
      return NextResponse.json({ error: `Connection ${id} baseUrl is missing` }, { status: 500 })
    }

    if (!conn.apiToken) {
      return NextResponse.json({ error: `Connection ${id} apiToken is missing` }, { status: 500 })
    }

    // 1) Nom/quorum depuis /cluster/status (si dispo)
    let clusterName = conn.name
    let quorum: any = null
    let cephHealth: string | null = null

    try {
      const status = await pveFetch<any[]>(conn, "/cluster/status")

      const clusterRow =
        status.find((x) => x?.type === "cluster") ||
        status.find((x) => x?.name || x?.clustername || x?.cluster_name)

      clusterName = String(clusterRow?.name || clusterRow?.clustername || clusterRow?.cluster_name || clusterName)

      const q =
        status.find((x) => x?.type === "quorum") ||
        status.find((x) => x?.quorate !== undefined || x?.expected_votes !== undefined)

      if (q) {
        quorum = {
          quorate: q.quorate ?? null,
          votes: q.votes ?? null,
          expected_votes: q.expected_votes ?? null,
          nodes: q.nodes ?? null,
        }
      }
    } catch {
      // OK: standalone ou endpoint indispo
    }

    // 2) Ceph status (si disponible)
    try {
      const ceph = await pveFetch<any>(conn, "/cluster/ceph/status")

      cephHealth = ceph?.health?.status || null
    } catch {
      // Ceph non configuré ou non disponible
    }

    // 3) KPI via /nodes/<node>/status
    const nodes = await pveFetch<any[]>(conn, "/nodes")
    const totalNodes = nodes.length
    const onlineNodes = nodes.filter((n) => String(n?.status).toLowerCase() === "online").length

    // Détails par node
    const nodeDetails: any[] = []

    const statuses = await Promise.all(
      nodes.map(async (n) => {
        const nodeName = n.node

        if (!nodeName) return null

        try {
          const st = await pveFetch<any>(conn, `/nodes/${encodeURIComponent(nodeName)}/status`)
          
          // Ajouter les détails du node
          nodeDetails.push({
            name: nodeName,
            id: n.id,
            status: n.status,
            ip: n.ip || st?.rootfs?.avail ? null : null, // IP pas toujours dispo
            cpuPct: round1((Number(st?.cpu || 0)) * 100),
            memPct: st?.memory?.total > 0 ? round1((Number(st?.memory?.used || 0) / Number(st?.memory?.total)) * 100) : 0,
            memUsed: Number(st?.memory?.used || 0),
            memTotal: Number(st?.memory?.total || 0),
            uptime: Number(st?.uptime || 0),
            cpuModel: st?.cpuinfo?.model || null,
            cpuCores: Number(st?.cpuinfo?.cores || 0) * Number(st?.cpuinfo?.sockets || 1),
            pveVersion: st?.pveversion || null,
            kernelVersion: st?.kversion || null,
            supportLevel: n.level || 'Community',
          })
          
          return st
        } catch {
          nodeDetails.push({
            name: nodeName,
            status: n.status,
            cpuPct: 0,
            memPct: 0,
          })
          
return null
        }
      })
    )

    const okStatuses = statuses.filter(Boolean) as any[]
    
    // CPU: moyenne
    const cpuAvgPct =
      okStatuses.length > 0
        ? round1((okStatuses.reduce((acc, s) => acc + Number(s?.cpu || 0), 0) / okStatuses.length) * 100)
        : 0
    
    // Total CPU cores
    const totalCpuCores = okStatuses.reduce((acc, s) => {
      const cores = Number(s?.cpuinfo?.cores || 0)
      const sockets = Number(s?.cpuinfo?.sockets || 1)

      
return acc + (cores * sockets)
    }, 0)

    // RAM
    const memUsed = okStatuses.reduce((acc, s) => acc + Number(s?.memory?.used || 0), 0)
    const memMax = okStatuses.reduce((acc, s) => acc + Number(s?.memory?.total || 0), 0)
    const ramPct = memMax > 0 ? round1((memUsed / memMax) * 100) : 0

    // Storage (rootfs)
    const storageUsed = okStatuses.reduce((acc, s) => acc + Number(s?.rootfs?.used || 0), 0)
    const storageMax = okStatuses.reduce((acc, s) => acc + Number(s?.rootfs?.total || 0), 0)
    const storagePct = storageMax > 0 ? round1((storageUsed / storageMax) * 100) : 0

    // 4) Guests - utiliser plusieurs méthodes pour récupérer les infos
    let guests = { vms: { total: 0, running: 0, stopped: 0, templates: 0 }, lxc: { total: 0, running: 0, stopped: 0 } }
    
    // Méthode 1: /cluster/resources (plus fiable pour les clusters)
    let guestsFound = false

    try {
      const resources = await pveFetch<any[]>(conn, "/cluster/resources")

      if (Array.isArray(resources) && resources.length > 0) {
        const vms = resources.filter((r) => r.type === "qemu")
        const lxcs = resources.filter((r) => r.type === "lxc")
        
        if (vms.length > 0 || lxcs.length > 0) {
          guests = {
            vms: {
              total: vms.length,
              running: vms.filter((v) => v.status === "running").length,
              stopped: vms.filter((v) => v.status === "stopped").length,
              templates: vms.filter((v) => v.template === 1).length,
            },
            lxc: {
              total: lxcs.length,
              running: lxcs.filter((v) => v.status === "running").length,
              stopped: lxcs.filter((v) => v.status === "stopped").length,
            },
          }
          guestsFound = true
        }
      }
    } catch (e) {
      // /cluster/resources failed, trying fallback
    }
    
    // Méthode 2: Fallback - récupérer depuis chaque node individuellement
    if (!guestsFound) {
      try {
        const allVms: any[] = []
        const allLxcs: any[] = []
        
        await Promise.all(
          nodes.map(async (n) => {
            const nodeName = n.node

            if (!nodeName) return
            
            try {
              const nodeVms = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/qemu`)

              if (Array.isArray(nodeVms)) {
                allVms.push(...nodeVms)
              }
            } catch {}
            
            try {
              const nodeLxcs = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/lxc`)

              if (Array.isArray(nodeLxcs)) {
                allLxcs.push(...nodeLxcs)
              }
            } catch {}
          })
        )
        
        guests = {
          vms: {
            total: allVms.length,
            running: allVms.filter((v) => v.status === "running").length,
            stopped: allVms.filter((v) => v.status === "stopped").length,
            templates: allVms.filter((v) => v.template === 1).length,
          },
          lxc: {
            total: allLxcs.length,
            running: allLxcs.filter((v) => v.status === "running").length,
            stopped: allLxcs.filter((v) => v.status === "stopped").length,
          },
        }
      } catch (e) {
        // Fallback guest fetch failed
      }
    }

    // 5) Health synthétique
    let health: "healthy" | "degraded" | "down" = "healthy"

    if (totalNodes > 0 && onlineNodes < totalNodes) health = "degraded"
    if (totalNodes > 0 && onlineNodes === 0) health = "down"

    return NextResponse.json({
      data: {
        id,
        name: clusterName,
        health,
        cephHealth,
        nodes: { 
          total: totalNodes, 
          online: onlineNodes,
          details: nodeDetails.sort((a, b) => a.name.localeCompare(b.name)),
        },
        resources: {
          cpuCores: totalCpuCores,
          cpuAvgPct,
          memUsed,
          memMax,
          memUsedFormatted: formatBytes(memUsed),
          memMaxFormatted: formatBytes(memMax),
          ramPct,
          storageUsed,
          storageMax,
          storageUsedFormatted: formatBytes(storageUsed),
          storageMaxFormatted: formatBytes(storageMax),
          storagePct,
        },
        guests,
        quorum,

        // Compat avec l'ancien format
        cpuAvgPct,
        ramPct,
        memUsed,
        memMax,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

