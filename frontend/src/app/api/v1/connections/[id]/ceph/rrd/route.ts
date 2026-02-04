import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

// Timeframes disponibles dans Proxmox RRD
type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const url = new URL(req.url)
    const timeframe = (url.searchParams.get('timeframe') || 'hour') as Timeframe

    const conn = await getConnectionById(id)

    // Récupérer la liste des nodes
    const nodes = await pveFetch<any[]>(conn, "/nodes")

    if (!nodes || nodes.length === 0) {
      return NextResponse.json({ error: "No nodes found" }, { status: 404 })
    }

    // Trouver un node online
    const onlineNode = nodes.find(n => n.status === 'online') || nodes[0]
    const nodeName = onlineNode.node

    // Récupérer les données RRD pour Ceph
    // Proxmox stocke les données Ceph dans les RRD du node
    let rrdData: any[] = []
    
    try {
      // Essayer d'abord les RRD spécifiques à Ceph si disponibles
      rrdData = await pveFetch<any[]>(
        conn, 
        `/nodes/${encodeURIComponent(nodeName)}/rrddata?timeframe=${timeframe}`
      )
    } catch (e) {
      // Fallback: pas de données RRD
      console.log('RRD data not available:', e)
    }

    // Parser et formater les données pour les graphiques
    const chartData = (Array.isArray(rrdData) ? rrdData : [])
      .filter(d => d && d.time)
      .map(d => {
        const time = new Date(d.time * 1000)

        
return {
          time: d.time,
          timeFormatted: time.toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit',
            ...(timeframe !== 'hour' ? { day: '2-digit', month: '2-digit' } : {})
          }),

          // CPU
          cpu: d.cpu ? Math.round(d.cpu * 100 * 10) / 10 : null,
          iowait: d.iowait ? Math.round(d.iowait * 100 * 10) / 10 : null,

          // Memory
          memUsed: d.memused || null,
          memTotal: d.memtotal || null,
          memPct: d.memtotal && d.memused ? Math.round((d.memused / d.memtotal) * 100 * 10) / 10 : null,

          // Network
          netIn: d.netin || d.neti || null,
          netOut: d.netout || d.neto || null,

          // Disk IO - Proxmox peut utiliser différentes clés
          diskRead: d.diskread || d.read_bytes || d.roottotal || null,
          diskWrite: d.diskwrite || d.write_bytes || d.rootused || null,

          // Load average
          loadAvg: d.loadavg || null,

          // Swap
          swapUsed: d.swapused || null,
          swapTotal: d.swaptotal || null,
        }
      })
      .sort((a, b) => a.time - b.time)

    // Essayer aussi de récupérer les métriques Ceph spécifiques via le status
    let cephMetrics: any = null

    try {
      const status = await pveFetch<any>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/status`)

      if (status?.pgmap) {
        cephMetrics = {
          // Performance actuelle
          readBytesSec: status.pgmap.read_bytes_sec || 0,
          writeBytesSec: status.pgmap.write_bytes_sec || 0,
          readOpsSec: status.pgmap.read_op_per_sec || 0,
          writeOpsSec: status.pgmap.write_op_per_sec || 0,

          // Recovering
          recoveringBytesPerSec: status.pgmap.recovering_bytes_per_sec || 0,
          recoveringKeysPerSec: status.pgmap.recovering_keys_per_sec || 0,
          recoveringObjectsPerSec: status.pgmap.recovering_objects_per_sec || 0,
        }
      }
    } catch {}

    // Récupérer les métriques des pools individuels
    let poolMetrics: any[] = []

    try {
      const pools = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/pool`)

      poolMetrics = (Array.isArray(pools) ? pools : []).map(pool => ({
        name: pool.pool_name || pool.name,
        id: pool.pool,
        bytesUsed: pool.bytes_used || 0,
        percentUsed: pool.percent_used || 0,
        maxAvail: pool.max_avail || 0,
        objects: pool.objects || 0,
      }))
    } catch {}

    // Récupérer les métriques OSD pour les latences
    let osdMetrics: any[] = []

    try {
      const osds = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/osd`)
      
      // Les OSDs peuvent être dans différents formats selon la version de Proxmox
      const osdArray = Array.isArray(osds) ? osds : (osds as any)?.root?.children || []
      
      // Fonction récursive pour extraire tous les OSDs de l'arbre
      const extractOsds = (items: any[]): any[] => {
        let result: any[] = []

        for (const item of items) {
          if (item.type === 'osd' || item.id !== undefined && item.name?.startsWith('osd.')) {
            result.push(item)
          }

          if (item.children && Array.isArray(item.children)) {
            result = result.concat(extractOsds(item.children))
          }
        }

        
return result
      }
      
      const flatOsds = extractOsds(osdArray)
      
      osdMetrics = flatOsds
        .filter(osd => osd.id !== undefined || osd.osd !== undefined)
        .map(osd => ({
          id: osd.id ?? osd.osd,
          name: osd.name || `osd.${osd.id ?? osd.osd}`,
          host: osd.host || osd.crush_location?.host || 'unknown',
          status: osd.status || (osd.up ? 'up' : 'down'),
          up: osd.up === 1 || osd.status === 'up',
          in: osd.in === 1,
          deviceClass: osd.device_class || osd.class || 'unknown',
          commitLatencyMs: osd.commit_latency_ms || osd.perf_stats?.commit_latency_ms || 0,
          applyLatencyMs: osd.apply_latency_ms || osd.perf_stats?.apply_latency_ms || 0,
          usedPct: osd.percent_used || 0,
        }))
        .sort((a, b) => a.id - b.id)
    } catch (e) {
      console.log('Failed to fetch OSD metrics:', e)
    }

    // Calculer les moyennes de latence
    const avgCommitLatency = osdMetrics.length > 0 
      ? Math.round(osdMetrics.reduce((acc, o) => acc + (o.commitLatencyMs || 0), 0) / osdMetrics.length * 10) / 10
      : 0

    const avgApplyLatency = osdMetrics.length > 0 
      ? Math.round(osdMetrics.reduce((acc, o) => acc + (o.applyLatencyMs || 0), 0) / osdMetrics.length * 10) / 10
      : 0

    const maxCommitLatency = Math.max(...osdMetrics.map(o => o.commitLatencyMs || 0), 0)
    const maxApplyLatency = Math.max(...osdMetrics.map(o => o.applyLatencyMs || 0), 0)

    return NextResponse.json({
      data: {
        timeframe,
        nodeName,

        // Données RRD historiques du node
        rrd: chartData,

        // Métriques Ceph temps réel
        current: cephMetrics,

        // Métriques par pool
        pools: poolMetrics,

        // Métriques OSD (latences)
        osds: osdMetrics,

        // Résumé des latences
        latency: {
          avgCommit: avgCommitLatency,
          avgApply: avgApplyLatency,
          maxCommit: maxCommitLatency,
          maxApply: maxApplyLatency,
        },

        // IOPS actuel pour affichage temps réel
        iops: cephMetrics ? {
          read: cephMetrics.readOpsSec,
          write: cephMetrics.writeOpsSec,
          total: (cephMetrics.readOpsSec || 0) + (cephMetrics.writeOpsSec || 0),
          readThroughput: cephMetrics.readBytesSec,
          writeThroughput: cephMetrics.writeBytesSec,
        } : null
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
