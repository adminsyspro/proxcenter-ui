import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"

export const runtime = "nodejs"

function formatBytesPerSec(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s', 'TiB/s']
  const i = Math.floor(Math.log(bytes) / Math.log(k))


return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const conn = await getConnectionById(id)

    // Récupérer la liste des nodes pour trouver un node avec Ceph
    const nodes = await pveFetch<any[]>(conn, "/nodes")

    if (!nodes || nodes.length === 0) {
      return NextResponse.json({ error: "No nodes found" }, { status: 404 })
    }

    // Trouver un node online pour interroger Ceph
    const onlineNode = nodes.find(n => n.status === 'online') || nodes[0]
    const nodeName = onlineNode.node

    // Récupérer les données Ceph en parallèle
    const [statusResult, osdResult, monResult, poolsResult, mdsResult] = await Promise.allSettled([
      pveFetch<any>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/status`),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/osd`),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/mon`),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/pool`),
      pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/ceph/mds`),
    ])

    const status = statusResult.status === 'fulfilled' ? statusResult.value : null
    const osdList = osdResult.status === 'fulfilled' ? osdResult.value : []
    const monList = monResult.status === 'fulfilled' ? monResult.value : []
    const poolList = poolsResult.status === 'fulfilled' ? poolsResult.value : []
    const mdsList = mdsResult.status === 'fulfilled' ? mdsResult.value : []

    // Si pas de status Ceph, le cluster n'a probablement pas Ceph
    if (!status) {
      return NextResponse.json({ 
        error: "Ceph not available on this cluster",
        hasCeph: false 
      }, { status: 404 })
    }

    // Parser le statut de santé
    const health = status.health?.status || 'UNKNOWN'
    const healthChecks = status.health?.checks || {}
    
    // Parser les checks de santé en liste
    const healthIssues: any[] = []

    for (const [checkName, checkData] of Object.entries(healthChecks)) {
      const data = checkData as any

      healthIssues.push({
        name: checkName,
        severity: data.severity || 'UNKNOWN',
        summary: data.summary?.message || checkName,
        detail: data.detail || []
      })
    }

    // Statistiques du cluster
    const pgmap = status.pgmap || {}
    const totalBytes = pgmap.bytes_total || 0
    const usedBytes = pgmap.bytes_used || 0
    const availBytes = pgmap.bytes_avail || 0
    const usedPct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100 * 10) / 10 : 0

    // Performance
    const readBytesSec = pgmap.read_bytes_sec || 0
    const writeBytesSec = pgmap.write_bytes_sec || 0
    const readOpsSec = pgmap.read_op_per_sec || 0
    const writeOpsSec = pgmap.write_op_per_sec || 0

    // PGs
    const numPgs = pgmap.num_pgs || 0
    const pgStates = pgmap.pgs_by_state || []

    // OSD stats
    const osdmap = status.osdmap?.osdmap || status.osdmap || {}
    const numOsds = osdmap.num_osds || 0
    const numUpOsds = osdmap.num_up_osds || 0
    const numInOsds = osdmap.num_in_osds || 0

    // Monmap
    const monmap = status.monmap || {}
    const numMons = monmap.num_mons || (monList?.length || 0)
    const quorum = status.quorum_names || []

    // Mapper les OSDs avec plus de détails
    // Les OSDs peuvent être dans un format arborescent dans Proxmox
    const extractOsdsFromTree = (items: any[]): any[] => {
      let result: any[] = []

      for (const item of items) {
        // C'est un OSD si il a un id numérique ou si type === 'osd'
        if (item.type === 'osd' || (item.id !== undefined && typeof item.id === 'number')) {
          result.push(item)
        }


        // Parcourir les enfants
        if (item.children && Array.isArray(item.children)) {
          result = result.concat(extractOsdsFromTree(item.children))
        }
      }

      
return result
    }
    
    // osdList peut être un tableau plat ou un objet avec root/children
    let flatOsdList: any[] = []

    if (Array.isArray(osdList)) {
      // Vérifier si c'est déjà plat ou arborescent
      if (osdList.length > 0 && osdList[0]?.children) {
        flatOsdList = extractOsdsFromTree(osdList)
      } else if (osdList.length > 0 && osdList[0]?.root?.children) {
        flatOsdList = extractOsdsFromTree(osdList[0].root.children)
      } else {
        flatOsdList = osdList
      }
    } else if (osdList && typeof osdList === 'object') {
      if ((osdList as any).root?.children) {
        flatOsdList = extractOsdsFromTree((osdList as any).root.children)
      }
    }
    
    const osds = flatOsdList
      .filter((osd: any) => osd.id !== undefined)
      .map((osd: any) => {
        // Proxmox retourne up et in de différentes manières selon le format
        // Dans l'arbre CRUSH: status peut être "up" directement
        // Dans la liste plate: up=1/0
        // Parfois c'est une string "up" ou "down"
        const statusStr = String(osd.status || '').toLowerCase()

        const isUp = osd.up === 1 || osd.up === true || osd.up === '1' || 
                     statusStr === 'up' || statusStr.includes('up')

        const isIn = osd.in === 1 || osd.in === true || osd.in === '1' ||
                     (osd.reweight !== undefined && osd.reweight > 0)
        
        return {
          id: osd.id,
          name: osd.name || `osd.${osd.id}`,
          host: osd.host || osd.crush_location?.host || 'unknown',
          status: osd.status || (isUp ? 'up' : 'down'),
          up: isUp,
          in: isIn,
          deviceClass: osd.device_class || osd.class || 'unknown',

          // Taille
          totalBytes: osd.crush_weight ? osd.crush_weight * 1024 * 1024 * 1024 * 1024 : 0,
          usedBytes: osd.kb_used ? osd.kb_used * 1024 : 0,
          availBytes: osd.kb_avail ? osd.kb_avail * 1024 : 0,
          usedPct: osd.percent_used || 0,

          // Stats
          commitLatencyMs: osd.commit_latency_ms || 0,
          applyLatencyMs: osd.apply_latency_ms || 0,
        }
      })
      .sort((a: any, b: any) => a.id - b.id)

    // Mapper les Monitors
    const monitors = (Array.isArray(monList) ? monList : []).map((mon: any) => {
      const isInQuorum = quorum.includes(mon.name)

      
return {
        name: mon.name,
        host: mon.host || mon.addr?.split(':')[0] || 'unknown',
        addr: mon.addr || '',
        rank: mon.rank,
        inQuorum: isInQuorum,
        leader: quorum[0] === mon.name,

        // Stats si disponibles
        storeStats: mon.store_stats || null,
      }
    })

    // Mapper les pools
    const pools = (Array.isArray(poolList) ? poolList : []).map((pool: any) => {
      const stats = pool.statistics || pool.stats || {}

      
return {
        id: pool.pool,
        name: pool.pool_name || pool.name || `pool-${pool.pool}`,
        size: pool.size || 3,
        minSize: pool.min_size || 2,
        pgNum: pool.pg_num || 0,
        pgNumTarget: pool.pg_num_target || pool.pg_num || 0,

        // Type
        type: pool.type || 'replicated',

        // Crush rule
        crushRule: pool.crush_rule || 0,

        // Autoscale
        pgAutoscaleMode: pool.pg_autoscale_mode || 'unknown',

        // Stats
        bytesUsed: stats.bytes_used || pool.bytes_used || 0,
        maxAvail: stats.max_avail || pool.max_avail || 0,
        objects: stats.objects || pool.objects || 0,

        // Formaté
        bytesUsedFormatted: formatBytes(stats.bytes_used || pool.bytes_used || 0),
        maxAvailFormatted: formatBytes(stats.max_avail || pool.max_avail || 0),
        percentUsed: pool.percent_used || 0,
      }
    })

    // Mapper les MDS (Metadata Servers pour CephFS)
    const mdsServers = (Array.isArray(mdsList) ? mdsList : []).map((mds: any) => {
      return {
        name: mds.name,
        host: mds.host || mds.addr?.split(':')[0] || 'unknown',
        addr: mds.addr || '',
        state: mds.state || 'unknown',
        rank: mds.rank,
      }
    })

    // Construire la réponse
    const cephData = {
      hasCeph: true,
      nodeName,
      
      // Santé
      health: {
        status: health,
        checks: healthIssues,
        numChecks: healthIssues.length,
      },

      // Capacité
      capacity: {
        totalBytes,
        usedBytes,
        availBytes,
        usedPct,
        totalFormatted: formatBytes(totalBytes),
        usedFormatted: formatBytes(usedBytes),
        availFormatted: formatBytes(availBytes),
      },

      // Performance
      performance: {
        readBytesSec,
        writeBytesSec,
        readOpsSec,
        writeOpsSec,
        readFormatted: formatBytesPerSec(readBytesSec),
        writeFormatted: formatBytesPerSec(writeBytesSec),
        totalIops: readOpsSec + writeOpsSec,
      },

      // PGs
      pgs: {
        total: numPgs,
        states: pgStates,
      },

      // OSDs
      osds: {
        total: numOsds,
        up: numUpOsds,
        in: numInOsds,
        down: numOsds - numUpOsds,
        out: numOsds - numInOsds,
        list: osds,
      },

      // Monitors
      monitors: {
        total: numMons,
        inQuorum: quorum.length,
        quorumNames: quorum,
        list: monitors,
      },

      // Pools
      pools: {
        total: pools.length,
        list: pools,
      },

      // MDS (CephFS)
      mds: {
        total: mdsServers.length,
        list: mdsServers,
      },

      // Raw status pour debug si nécessaire
      // rawStatus: status,
    }

    return NextResponse.json({ data: cephData })
  } catch (e: any) {
    // Si erreur 501 ou 500, Ceph n'est probablement pas installé
    if (e?.message?.includes('501') || e?.message?.includes('not installed')) {
      return NextResponse.json({ 
        error: "Ceph not installed on this cluster",
        hasCeph: false 
      }, { status: 404 })
    }

    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
