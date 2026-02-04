import crypto from "crypto"

import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getConnectionById, getPbsConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  
return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Générer un fingerprint unique pour une alerte (sans le message qui contient des valeurs variables)
function generateFingerprint(alert: {
  source: string
  severity: string
  entityType?: string
  entityId?: string
  metric?: string
}): string {
  // On utilise uniquement les champs stables pour identifier l'alerte
  // Le message contient des valeurs variables (%, etc.) donc on l'exclut
  const data = `${alert.source}|${alert.severity}|${alert.entityType || ''}|${alert.entityId || ''}|${alert.metric || ''}`

  
return crypto.createHash('md5').update(data).digest('hex')
}

// Synchroniser les alertes en base de données
async function syncAlertsToDatabase(alerts: any[]) {
  const now = new Date()
  const currentFingerprints: string[] = []

  // Traiter chaque alerte
  for (const alert of alerts) {
    const fingerprint = generateFingerprint({
      source: alert.source,
      severity: alert.severity,
      entityType: alert.entityType,
      entityId: alert.entityId,
      metric: alert.metric,
    })

    currentFingerprints.push(fingerprint)

    try {
      // Upsert l'alerte
      const existing = await prisma.alert.findUnique({ where: { fingerprint } })

      if (existing) {
        // Mettre à jour si l'alerte existe et n'est pas résolue manuellement récemment
        if (existing.status !== 'resolved' || 
            (existing.resolvedAt && (now.getTime() - existing.resolvedAt.getTime()) > 300000)) {
          await prisma.alert.update({
            where: { fingerprint },
            data: {
              status: existing.status === 'resolved' ? 'active' : existing.status,
              resolvedAt: existing.status === 'resolved' ? null : existing.resolvedAt,
              lastSeenAt: now,
              message: alert.message, // Met à jour le message avec la nouvelle valeur
              currentValue: alert.currentValue,
              occurrences: { increment: existing.status === 'resolved' ? 0 : 1 }
            }
          })
        }
      } else {
        // Créer nouvelle alerte
        await prisma.alert.create({
          data: {
            fingerprint,
            severity: alert.severity,
            message: alert.message,
            source: alert.source,
            sourceType: alert.sourceType || 'pve',
            entityType: alert.entityType,
            entityId: alert.entityId,
            entityName: alert.entityName,
            metric: alert.metric,
            currentValue: alert.currentValue,
            threshold: alert.threshold,
            status: 'active',
            firstSeenAt: now,
            lastSeenAt: now,
            occurrences: 1
          }
        })
      }
    } catch (e) {
      // Ignorer les erreurs individuelles pour ne pas bloquer
      console.error('[dashboard] Alert upsert error:', e)
    }
  }

  // Résoudre automatiquement les alertes actives qui ne sont plus présentes
  try {
    await prisma.alert.updateMany({
      where: {
        status: 'active',
        ...(currentFingerprints.length > 0 
          ? { fingerprint: { notIn: currentFingerprints } }
          : {}
        ),
        lastSeenAt: { lt: new Date(now.getTime() - 120000) } // 2 min de grace
      },
      data: {
        status: 'resolved',
        resolvedAt: now
      }
    })
  } catch (e) {
    console.error('[dashboard] Alert resolve error:', e)
  }
}

export async function GET() {
  try {
    // Récupérer toutes les connexions (PVE et PBS) en une seule requête
    const allConnections = await prisma.connection.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, type: true, hasCeph: true },
    })

    const pveConnections = allConnections.filter(c => c.type === 'pve')
    const pbsConnections = allConnections.filter(c => c.type === 'pbs')

    // ============================================
    // CHARGER PVE ET PBS EN PARALLÈLE
    // ============================================
    const [pveResults, pbsResults] = await Promise.all([
      // PVE
      Promise.all(pveConnections.map(async (conn) => {
        try {
          const connData = await getConnectionById(conn.id)

          if (!connData.baseUrl || !connData.apiToken) return null

          const [nodesResult, resourcesResult, statusResult, cephResult] = await Promise.allSettled([
            pveFetch<any[]>(connData, "/nodes"),
            pveFetch<any[]>(connData, "/cluster/resources"),
            pveFetch<any[]>(connData, "/cluster/status"),
            conn.hasCeph ? pveFetch<any>(connData, "/cluster/ceph/status") : Promise.resolve(null),
          ])

          const nodes = nodesResult.status === 'fulfilled' ? nodesResult.value || [] : []
          const resources = resourcesResult.status === 'fulfilled' ? resourcesResult.value || [] : []
          const status = statusResult.status === 'fulfilled' ? statusResult.value || [] : []
          const cephStatus = cephResult.status === 'fulfilled' ? cephResult.value : null

          const clusterRow = status.find((x: any) => x?.type === "cluster")
          const clusterName = clusterRow?.name || conn.name || conn.id
          const quorumRow = status.find((x: any) => x?.type === "quorum" || x?.quorate !== undefined)

          const vms = resources.filter((r: any) => r.type === 'qemu')
          const lxcs = resources.filter((r: any) => r.type === 'lxc')

          // Node status en parallèle
          const nodeStatuses = await Promise.all(nodes.map(async (node: any) => {
            if (!node?.node || node.status !== 'online') {
              return { node: node.node, status: node.status, cpuCores: 0, cpuUsage: 0, memUsed: 0, memMax: 0, storageUsed: 0, storageMax: 0, uptime: 0 }
            }

            try {
              const nodeStatus = await pveFetch<any>(connData, `/nodes/${encodeURIComponent(node.node)}/status`)
              const cpuCores = (Number(nodeStatus?.cpuinfo?.cores || 0) * Number(nodeStatus?.cpuinfo?.sockets || 1)) || 0

              
return {
                node: node.node, status: node.status, cpuCores,
                cpuUsage: Number(nodeStatus?.cpu || 0),
                memUsed: Number(nodeStatus?.memory?.used || 0),
                memMax: Number(nodeStatus?.memory?.total || 0),
                storageUsed: Number(nodeStatus?.rootfs?.used || 0),
                storageMax: Number(nodeStatus?.rootfs?.total || 0),
                uptime: Number(nodeStatus?.uptime || 0),
              }
            } catch {
              return { node: node.node, status: node.status, cpuCores: 0, cpuUsage: 0, memUsed: 0, memMax: 0, storageUsed: 0, storageMax: 0, uptime: 0 }
            }
          }))

          return { conn, clusterName, isCluster: nodes.length > 1, quorum: quorumRow, nodes: nodeStatuses, vms, lxcs, cephStatus }
        } catch (e) {
          console.error(`[dashboard] PVE error ${conn.id}:`, e)
          
return null
        }
      })),

      // PBS
      Promise.all(pbsConnections.map(async (conn) => {
        try {
          const connData = await getPbsConnectionById(conn.id)
          
          const [datastores, tasks] = await Promise.allSettled([
            pbsFetch<any[]>(connData, "/admin/datastore"),
            pbsFetch<any[]>(connData, "/nodes/localhost/tasks?limit=50"),
          ])

          const datastoreList = datastores.status === 'fulfilled' ? datastores.value || [] : []
          const taskList = tasks.status === 'fulfilled' ? tasks.value || [] : []

          // Stats des datastores en parallèle
          const dsStats = await Promise.all(datastoreList.map(async (ds: any) => {
            const storeName = ds.store || ds.name

            if (!storeName) return null

            try {
              const dsStatus = await pbsFetch<any>(connData, `/admin/datastore/${encodeURIComponent(storeName)}/status`)

              
return {
                name: storeName,
                total: Number(dsStatus?.total || 0),
                used: Number(dsStatus?.used || 0),
                avail: Number(dsStatus?.avail || 0),
              }
            } catch { return null }
          }))

          const validDsStats = dsStats.filter(Boolean)
          let totalSize = 0, totalUsed = 0

          for (const ds of validDsStats) {
            if (ds) { totalSize += ds.total; totalUsed += ds.used }
          }

          // Analyser les tâches récentes (dernières 24h)
          const now = Date.now() / 1000
          const last24h = taskList.filter((t: any) => t.starttime && (now - t.starttime) < 86400)
          const backupTasks = last24h.filter((t: any) => t.worker_type === 'backup')
          const verifyTasks = last24h.filter((t: any) => t.worker_type === 'verify')
          const gcTasks = last24h.filter((t: any) => t.worker_type === 'garbage_collection')

          return {
            conn,
            datastoreCount: datastoreList.length,
            totalSize,
            totalUsed,
            usagePct: totalSize > 0 ? round1((totalUsed / totalSize) * 100) : 0,
            datastores: validDsStats,
            tasks: {
              backup: { total: backupTasks.length, ok: backupTasks.filter((t: any) => t.status === 'OK').length, error: backupTasks.filter((t: any) => t.status && t.status !== 'OK').length },
              verify: { total: verifyTasks.length, ok: verifyTasks.filter((t: any) => t.status === 'OK').length, error: verifyTasks.filter((t: any) => t.status && t.status !== 'OK').length },
              gc: { total: gcTasks.length, ok: gcTasks.filter((t: any) => t.status === 'OK').length, error: gcTasks.filter((t: any) => t.status && t.status !== 'OK').length },
            },
            recentErrors: last24h.filter((t: any) => t.status && t.status !== 'OK').slice(0, 5).map((t: any) => ({
              type: t.worker_type,
              id: t.worker_id,
              status: t.status,
              time: t.starttime,
            })),
          }
        } catch (e) {
          console.error(`[dashboard] PBS error ${conn.id}:`, e)
          
return null
        }
      })),
    ])

    // ============================================
    // AGRÉGER LES DONNÉES PVE
    // ============================================
    const validPve = pveResults.filter((c): c is NonNullable<typeof c> => c !== null)

    let totalClusters = 0, totalNodes = 0, onlineNodes = 0
    let totalCpuCores = 0, totalCpuUsed = 0, totalMemUsed = 0, totalMemMax = 0, totalStorageUsed = 0, totalStorageMax = 0
    const allVms: any[] = [], allLxcs: any[] = [], allNodes: any[] = [], clusterInfos: any[] = []
    let cephGlobal: any = null

    for (const data of validPve) {
      if (data.isCluster) totalClusters++

      for (const node of data.nodes) {
        totalNodes++
        if (node.status === 'online') onlineNodes++
        totalCpuCores += node.cpuCores
        totalCpuUsed += node.cpuUsage * node.cpuCores
        totalMemUsed += node.memUsed
        totalMemMax += node.memMax
        totalStorageUsed += node.storageUsed
        totalStorageMax += node.storageMax

        allNodes.push({
          name: node.node, connection: data.conn.name || data.conn.id, connectionId: data.conn.id,
          status: node.status, cpuPct: round1(node.cpuUsage * 100),
          memPct: node.memMax > 0 ? round1((node.memUsed / node.memMax) * 100) : 0, uptime: node.uptime,
        })
      }

      for (const vm of data.vms) allVms.push({ ...vm, connection: data.conn.name, connectionId: data.conn.id })
      for (const lxc of data.lxcs) allLxcs.push({ ...lxc, connection: data.conn.name, connectionId: data.conn.id })

      clusterInfos.push({
        id: data.conn.id, name: data.clusterName, isCluster: data.isCluster, nodes: data.nodes.length,
        onlineNodes: data.nodes.filter(n => n.status === 'online').length,
        quorum: data.quorum ? { quorate: data.quorum.quorate, votes: data.quorum.votes, expected_votes: data.quorum.expected_votes } : null,
        cephHealth: data.cephStatus?.health?.status || null,
      })

      if (!cephGlobal && data.cephStatus) {
        const pgmap = data.cephStatus?.pgmap || {}
        const osdmap = data.cephStatus?.osdmap?.osdmap || data.cephStatus?.osdmap || {}

        cephGlobal = {
          available: true, health: data.cephStatus?.health?.status || 'UNKNOWN',
          osdsTotal: Number(osdmap?.num_osds || 0), osdsUp: Number(osdmap?.num_up_osds || 0), osdsIn: Number(osdmap?.num_in_osds || 0),
          pgsTotal: Number(pgmap?.num_pgs || 0), bytesTotal: Number(pgmap?.bytes_total || 0), bytesUsed: Number(pgmap?.bytes_used || 0),
          usedPct: pgmap?.bytes_total > 0 ? round1((Number(pgmap?.bytes_used || 0) / Number(pgmap?.bytes_total)) * 100) : 0,
          readBps: Number(pgmap?.read_bytes_sec || 0), writeBps: Number(pgmap?.write_bytes_sec || 0),
        }
      }
    }

    // ============================================
    // AGRÉGER LES DONNÉES PBS
    // ============================================
    const validPbs = pbsResults.filter((c): c is NonNullable<typeof c> => c !== null)

    let pbsTotalSize = 0, pbsTotalUsed = 0, pbsTotalDatastores = 0
    let pbsBackupsOk = 0, pbsBackupsError = 0, pbsVerifyOk = 0, pbsVerifyError = 0
    const pbsServers: any[] = []
    const pbsRecentErrors: any[] = []

    for (const data of validPbs) {
      pbsTotalSize += data.totalSize
      pbsTotalUsed += data.totalUsed
      pbsTotalDatastores += data.datastoreCount
      pbsBackupsOk += data.tasks.backup.ok
      pbsBackupsError += data.tasks.backup.error
      pbsVerifyOk += data.tasks.verify.ok
      pbsVerifyError += data.tasks.verify.error

      pbsServers.push({
        id: data.conn.id, name: data.conn.name, datastores: data.datastoreCount,
        totalSize: data.totalSize, totalUsed: data.totalUsed, usagePct: data.usagePct,
        backups24h: data.tasks.backup.total, backupsOk: data.tasks.backup.ok, backupsError: data.tasks.backup.error,
      })

      for (const err of data.recentErrors) {
        pbsRecentErrors.push({ ...err, server: data.conn.name })
      }
    }

    // ============================================
    // CALCULS GLOBAUX
    // ============================================
    const globalCpuPct = totalCpuCores > 0 ? round1((totalCpuUsed / totalCpuCores) * 100) : 0
    const globalRamPct = totalMemMax > 0 ? round1((totalMemUsed / totalMemMax) * 100) : 0
    const globalStoragePct = totalStorageMax > 0 ? round1((totalStorageUsed / totalStorageMax) * 100) : 0

    const vmsRunning = allVms.filter(v => v.status === "running").length
    const vmsStopped = allVms.filter(v => v.status === "stopped").length
    const vmsTemplates = allVms.filter(v => v.template === 1).length
    const lxcRunning = allLxcs.filter(l => l.status === "running").length
    const lxcStopped = allLxcs.filter(l => l.status === "stopped").length

    // Top consumers
    const runningVms = allVms.filter(v => v.status === "running")
    const topCpu = runningVms.map(v => ({ name: v.name || `VM ${v.vmid}`, vmid: v.vmid, node: v.node, value: round1(Number(v.cpu || 0) * 100) })).sort((a, b) => b.value - a.value).slice(0, 10)

    const topRam = runningVms.map(v => { const used = Number(v.mem || 0), max = Number(v.maxmem || 0);

 

return { name: v.name || `VM ${v.vmid}`, vmid: v.vmid, node: v.node, value: max > 0 ? round1((used / max) * 100) : 0 } }).sort((a, b) => b.value - a.value).slice(0, 10)

    // ============================================
    // ALERTES (PVE + PBS) avec contexte complet
    // ============================================
    const alerts: any[] = []

    // Alertes PVE - Nodes
    for (const node of allNodes) {
      if (node.status !== 'online') {
        alerts.push({ 
          severity: 'crit', 
          message: `Node ${node.name} : OFFLINE`, 
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          metric: 'status',
          time: new Date().toISOString() 
        })
      }

      if (node.memPct > 90) {
        alerts.push({ 
          severity: 'crit', 
          message: `Node ${node.name} : RAM critique (${node.memPct}%)`, 
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          metric: 'ram',
          currentValue: node.memPct,
          threshold: 90,
          time: new Date().toISOString() 
        })
      } else if (node.memPct > 80) {
        alerts.push({ 
          severity: 'warn', 
          message: `Node ${node.name} : RAM élevée (${node.memPct}%)`, 
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          metric: 'ram',
          currentValue: node.memPct,
          threshold: 80,
          time: new Date().toISOString() 
        })
      }

      if (node.cpuPct > 90) {
        alerts.push({ 
          severity: 'crit', 
          message: `Node ${node.name} : CPU critique (${node.cpuPct}%)`, 
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          metric: 'cpu',
          currentValue: node.cpuPct,
          threshold: 90,
          time: new Date().toISOString() 
        })
      } else if (node.cpuPct > 80) {
        alerts.push({ 
          severity: 'warn', 
          message: `Node ${node.name} : CPU élevé (${node.cpuPct}%)`, 
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          metric: 'cpu',
          currentValue: node.cpuPct,
          threshold: 80,
          time: new Date().toISOString() 
        })
      }
    }

    // Alertes Ceph
    if (cephGlobal?.health && cephGlobal.health !== 'HEALTH_OK') {
      alerts.push({ 
        severity: cephGlobal.health === 'HEALTH_WARN' ? 'warn' : 'crit', 
        message: `Ceph : ${cephGlobal.health}`, 
        source: 'Ceph Cluster',
        sourceType: 'ceph',
        entityType: 'cluster',
        metric: 'health',
        time: new Date().toISOString() 
      })
    }

    // Alertes Quorum
    for (const cluster of clusterInfos) {
      if (cluster.quorum && !cluster.quorum.quorate) {
        alerts.push({ 
          severity: 'crit', 
          message: `Cluster ${cluster.name} : Quorum perdu !`, 
          source: cluster.name,
          sourceType: 'pve',
          entityType: 'cluster',
          entityId: cluster.id,
          entityName: cluster.name,
          metric: 'quorum',
          time: new Date().toISOString() 
        })
      }
    }

    // Alertes PBS
    for (const pbs of pbsServers) {
      if (pbs.usagePct > 90) {
        alerts.push({ 
          severity: 'crit', 
          message: `PBS ${pbs.name} : Stockage critique (${pbs.usagePct}%)`, 
          source: pbs.name,
          sourceType: 'pbs',
          entityType: 'server',
          entityId: pbs.id,
          entityName: pbs.name,
          metric: 'storage',
          currentValue: pbs.usagePct,
          threshold: 90,
          time: new Date().toISOString() 
        })
      } else if (pbs.usagePct > 80) {
        alerts.push({ 
          severity: 'warn', 
          message: `PBS ${pbs.name} : Stockage élevé (${pbs.usagePct}%)`, 
          source: pbs.name,
          sourceType: 'pbs',
          entityType: 'server',
          entityId: pbs.id,
          entityName: pbs.name,
          metric: 'storage',
          currentValue: pbs.usagePct,
          threshold: 80,
          time: new Date().toISOString() 
        })
      }

      if (pbs.backupsError > 0) {
        alerts.push({ 
          severity: 'warn', 
          message: `PBS ${pbs.name} : ${pbs.backupsError} backup(s) échoué(s) (24h)`, 
          source: pbs.name,
          sourceType: 'pbs',
          entityType: 'server',
          entityId: pbs.id,
          entityName: pbs.name,
          metric: 'backup',
          currentValue: pbs.backupsError,
          time: new Date().toISOString() 
        })
      }
    }

    const severityOrder: Record<string, number> = { crit: 0, warn: 1, info: 2 }

    alerts.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2))

    // ============================================
    // SYNCHRONISER LES ALERTES EN BASE (async, non-bloquant)
    // ============================================
    syncAlertsToDatabase(alerts).catch(err => console.error('[dashboard] Alert sync error:', err))

    return NextResponse.json({
      data: {
        summary: {
          clusters: totalClusters, standalones: pveConnections.length - totalClusters,
          nodes: totalNodes, nodesOnline: onlineNodes, nodesOffline: totalNodes - onlineNodes,
          vmsRunning, vmsTotal: allVms.length, lxcRunning, lxcTotal: allLxcs.length,
          cpuPct: globalCpuPct, ramPct: globalRamPct,
        },
        clusters: clusterInfos,
        nodes: allNodes,
        guests: {
          vms: { total: allVms.length, running: vmsRunning, stopped: vmsStopped, templates: vmsTemplates },
          lxc: { total: allLxcs.length, running: lxcRunning, stopped: lxcStopped },
        },
        resources: {
          cpuCores: totalCpuCores, cpuPct: globalCpuPct,
          memUsed: totalMemUsed, memMax: totalMemMax, memUsedFormatted: formatBytes(totalMemUsed), memMaxFormatted: formatBytes(totalMemMax), ramPct: globalRamPct,
          storageUsed: totalStorageUsed, storageMax: totalStorageMax, storageUsedFormatted: formatBytes(totalStorageUsed), storageMaxFormatted: formatBytes(totalStorageMax), storagePct: globalStoragePct,
        },
        ceph: cephGlobal,

        // NOUVELLES DONNÉES PBS
        pbs: {
          servers: pbsConnections.length,
          datastores: pbsTotalDatastores,
          totalSize: pbsTotalSize,
          totalUsed: pbsTotalUsed,
          totalSizeFormatted: formatBytes(pbsTotalSize),
          totalUsedFormatted: formatBytes(pbsTotalUsed),
          usagePct: pbsTotalSize > 0 ? round1((pbsTotalUsed / pbsTotalSize) * 100) : 0,
          backups24h: { total: pbsBackupsOk + pbsBackupsError, ok: pbsBackupsOk, error: pbsBackupsError },
          verify24h: { total: pbsVerifyOk + pbsVerifyError, ok: pbsVerifyOk, error: pbsVerifyError },
          serverDetails: pbsServers,
          recentErrors: pbsRecentErrors.slice(0, 10),
        },
        alerts: alerts.slice(0, 20),
        alertsSummary: { crit: alerts.filter(a => a.severity === 'crit').length, warn: alerts.filter(a => a.severity === 'warn').length, info: alerts.filter(a => a.severity === 'info').length },
        topCpu,
        topRam,
        lastUpdated: new Date().toISOString(),
      }
    })
  } catch (e: any) {
    console.error("[dashboard] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
