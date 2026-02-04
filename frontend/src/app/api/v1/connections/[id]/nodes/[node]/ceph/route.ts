import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/ceph
 * 
 * Récupère toutes les données Ceph pour un node spécifique :
 * - Status & Configuration (via /ceph/status)
 * - Monitors
 * - Managers
 * - OSDs
 * - CephFS / MDS
 * - Pools
 * - Log (via /ceph/log ou /syslog)
 * 
 * Query params:
 * - section: 'all' | 'config' | 'mon' | 'osd' | 'mds' | 'pools' | 'log' | 'status'
 * - logLines: number (default 100)
 */

// Fonction pour extraire les OSDs d'une structure arborescente
function extractOsdsFromTree(items: any[]): any[] {
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string; node: string }> | { id: string; node: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const node = (params as any)?.node

    if (!id || !node) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 })
    }

    const url = new URL(req.url)
    const section = url.searchParams.get('section') || 'all'
    const logLines = parseInt(url.searchParams.get('logLines') || '100', 10)

    const conn = await getConnectionById(id)

    // Vérifier d'abord si Ceph est disponible et récupérer le status
    let initialStatus: any = null
    try {
      initialStatus = await pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/ceph/status`)
    } catch {
      // Ceph n'est pas installé
    }

    if (!initialStatus?.health) {
      return NextResponse.json({ 
        hasCeph: false,
        message: "Ceph is not installed on this node"
      })
    }

    const result: any = { hasCeph: true }

    // Fonction helper pour récupérer les données avec gestion d'erreur silencieuse
    const fetchSafe = async <T>(path: string): Promise<T | null> => {
      try {
        return await pveFetch<T>(conn, path)
      } catch {
        // Silencieux - certains endpoints peuvent ne pas être disponibles
        return null
      }
    }

    // Status (toujours inclus) - contient beaucoup d'informations
    if (section === 'all' || section === 'status') {
      result.status = initialStatus
      result.health = initialStatus.health
      result.version = initialStatus.versions?.overall?.version || initialStatus.version
    }

    // Configuration - extraite du status car /ceph/config n'existe pas au niveau node
    if (section === 'all' || section === 'config') {
      // La configuration est dans le status - on extrait les informations disponibles
      const monmap = initialStatus.monmap || {}
      const fsid = monmap.fsid || initialStatus.fsid
      
      // Construire une représentation de la config à partir des données disponibles
      const configData: any = {
        '[global]': {
          fsid: fsid,
          mon_host: (monmap.mons || []).map((m: any) => m.addr?.split('/')[0] || m.public_addr?.split('/')[0]).filter(Boolean).join(' '),
          cluster_network: initialStatus.cluster_network,
          public_network: initialStatus.public_network,
        },
        '[client]': {
          keyring: '/etc/pve/priv/$cluster.$name.keyring'
        }
      }
      
      // Récupérer le crush map si disponible
      const crush = await fetchSafe<any>(`/nodes/${encodeURIComponent(node)}/ceph/crush`)
      
      result.config = {
        global: configData,
        database: [], // Non disponible via l'API node
        crushMap: crush
      }
    }

    // Monitors
    if (section === 'all' || section === 'mon') {
      const mon = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/ceph/mon`)
      result.monitors = Array.isArray(mon) ? mon : []
    }

    // Managers (via status.mgrmap)
    if (section === 'all' || section === 'mon') {
      result.managers = initialStatus?.mgrmap ? {
        active: initialStatus.mgrmap.active_name,
        activeAddr: initialStatus.mgrmap.active_addr,
        standbys: initialStatus.mgrmap.standbys || []
      } : null
    }

    // OSDs - avec extraction de l'arbre
    if (section === 'all' || section === 'osd') {
      const osdRaw = await fetchSafe<any>(`/nodes/${encodeURIComponent(node)}/ceph/osd`)
      
      // Extraire les OSDs de la structure arborescente
      let flatOsdList: any[] = []
      
      if (Array.isArray(osdRaw)) {
        if (osdRaw.length > 0 && osdRaw[0]?.children) {
          flatOsdList = extractOsdsFromTree(osdRaw)
        } else if (osdRaw.length > 0 && osdRaw[0]?.root?.children) {
          flatOsdList = extractOsdsFromTree(osdRaw[0].root.children)
        } else {
          flatOsdList = osdRaw
        }
      } else if (osdRaw && typeof osdRaw === 'object') {
        if ((osdRaw as any).root?.children) {
          flatOsdList = extractOsdsFromTree((osdRaw as any).root.children)
        } else if ((osdRaw as any).nodes) {
          flatOsdList = extractOsdsFromTree((osdRaw as any).nodes)
        }
      }
      
      // Mapper les OSDs avec les détails
      result.osds = flatOsdList
        .filter((osd: any) => osd.id !== undefined)
        .map((osd: any) => {
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
            device_class: osd.device_class || osd.class || 'nvme',
            osdtype: osd.osdtype || osd.type_str || 'bluestore',
            crush_weight: osd.crush_weight,
            reweight: osd.reweight ?? 1,
            kb: osd.kb || osd.total_bytes,
            kb_used: osd.kb_used || osd.used_bytes,
            kb_avail: osd.kb_avail || osd.avail_bytes,
            percent_used: osd.percent_used || (osd.kb && osd.kb_used ? (osd.kb_used / osd.kb) * 100 : 0),
            num_pgs: osd.num_pgs || osd.pgs,
            ceph_version_short: osd.ceph_version_short || osd.version,
          }
        })
        .sort((a: any, b: any) => a.id - b.id)
      
      // OSD stats depuis le status
      const osdmap = initialStatus.osdmap?.osdmap || initialStatus.osdmap || {}
      result.osdStats = {
        num_osds: osdmap.num_osds,
        num_up_osds: osdmap.num_up_osds,
        num_in_osds: osdmap.num_in_osds,
      }
    }

    // MDS / CephFS
    if (section === 'all' || section === 'mds') {
      const mds = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/ceph/mds`)
      const fs = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/ceph/fs`)
      
      result.mds = Array.isArray(mds) ? mds : []
      result.cephfs = Array.isArray(fs) ? fs : []
    }

    // Pools
    if (section === 'all' || section === 'pools') {
      const pools = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/ceph/pool`)
      const rules = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/ceph/rules`)
      
      result.pools = Array.isArray(pools) ? pools : []
      result.crushRules = Array.isArray(rules) ? rules : []
    }

    // Log - Lire les logs les plus récents
    if (section === 'all' || section === 'log') {
      let logEntries: string[] = []
      
      // L'API Proxmox /ceph/log lit depuis le début du fichier par défaut
      // Le paramètre 'start' indique à partir de quelle ligne commencer
      // Stratégie : faire une première requête pour obtenir le numéro de ligne max (via 'n')
      // puis calculer le start pour obtenir les dernières lignes
      
      // Étape 1: Récupérer quelques logs pour connaître le numéro de ligne actuel
      const probeLog = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/ceph/log?limit=1`)
      
      let startLine = 0
      if (Array.isArray(probeLog) && probeLog.length > 0) {
        // Le champ 'n' contient le numéro de ligne
        // On cherche le numéro de ligne le plus élevé pour estimer la taille du fichier
        // Mais avec limit=1, on n'a que la première ligne...
        // Essayons plutôt de faire une requête avec un start très élevé et voir ce qui revient
      }
      
      // Approche alternative : utiliser le syslog qui retourne les logs récents par défaut
      // ou faire plusieurs tentatives avec différentes valeurs de start
      
      // Essai 1: Utiliser /syslog avec filtre ceph (retourne les logs récents)
      const syslog = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/syslog?limit=${logLines}`)
      
      if (Array.isArray(syslog) && syslog.length > 0) {
        // Filtrer pour ne garder que les logs ceph
        logEntries = syslog
          .filter((entry: any) => {
            const msg = entry.t || entry.m || ''
            return msg.toLowerCase().includes('ceph') || 
                   msg.includes('mgr.') || 
                   msg.includes('osd.') || 
                   msg.includes('mon.') ||
                   msg.includes('mds.')
          })
          .map((entry: any) => {
            if (typeof entry === 'string') return entry
            if (entry.t && typeof entry.t === 'string') {
              return entry.t
            }
            return JSON.stringify(entry)
          })
      }
      
      // Si syslog n'a pas de logs ceph, essayer /ceph/log
      if (logEntries.length === 0) {
        const cephLog = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/ceph/log?limit=${logLines}`)
        
        if (Array.isArray(cephLog) && cephLog.length > 0) {
          // Trouver le numéro de ligne max dans les résultats
          let maxN = 0
          for (const entry of cephLog) {
            if (entry.n && entry.n > maxN) maxN = entry.n
          }
          
          // Si on a trouvé des lignes avec des numéros, on peut calculer le start
          // pour obtenir les dernières lignes
          if (maxN > logLines) {
            // Faire une nouvelle requête avec le bon start
            const recentLog = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/ceph/log?start=${maxN - logLines}&limit=${logLines}`)
            if (Array.isArray(recentLog)) {
              logEntries = recentLog.map((entry: any) => {
                if (typeof entry === 'string') return entry
                if (entry.t && typeof entry.t === 'string') return entry.t
                return JSON.stringify(entry)
              }).reverse()
            }
          } else {
            // Pas assez de logs, on prend tout et on inverse
            logEntries = cephLog.map((entry: any) => {
              if (typeof entry === 'string') return entry
              if (entry.t && typeof entry.t === 'string') return entry.t
              return JSON.stringify(entry)
            }).reverse()
          }
        }
      }
      
      // Méthode 3: Utiliser les health checks du status comme fallback
      if (logEntries.length === 0 && initialStatus.health?.checks) {
        const checks = initialStatus.health.checks
        for (const [checkName, checkData] of Object.entries(checks)) {
          const data = checkData as any
          const severity = data.severity || 'INFO'
          const message = data.summary?.message || checkName
          logEntries.push(`[${severity}] ${checkName}: ${message}`)
          
          if (data.detail && Array.isArray(data.detail)) {
            for (const detail of data.detail) {
              if (detail.message) {
                logEntries.push(`  └─ ${detail.message}`)
              }
            }
          }
        }
      }
      
      result.log = logEntries
      result.logSource = logEntries.length > 0 ? 'syslog' : 'none'
    }

    // Retourner avec headers no-cache pour les logs en temps réel
    return NextResponse.json({ data: result }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })

  } catch (e: any) {
    console.error("[ceph/node] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to fetch Ceph data" }, { status: 500 })
  }
}
