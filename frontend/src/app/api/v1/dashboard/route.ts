import { NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { getVdcScope } from '@/lib/vdc/scope'
import { pveFetch } from "@/lib/proxmox/client"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getConnectionById, getPbsConnectionById } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"
import { generateFingerprint } from "@/lib/alerts/fingerprint"
import { loadActiveSilenceFingerprints } from "@/lib/alerts/silenceFilter"
import { mergeAndFilterDashboardAlerts } from "@/lib/alerts/dashboardAlertMerge"
import { authOptions } from "@/lib/auth/config"
import { filterVmsByPermission, filterNodesByPermission } from "@/lib/rbac"
import { alertsApi } from "@/lib/orchestrator/client"
import { demoResponse } from "@/lib/demo/demo-api"
import { getSetting } from "@/lib/db/settings"

export const runtime = "nodejs"

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10
}

// Synchroniser les alertes en base de données
async function syncAlertsToDatabase(alerts: any[]) {
  const prisma = await getSessionPrisma()
  const tenantId = await getCurrentTenantId()
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
      const existing = await prisma.alert.findUnique({ where: { tenantId_fingerprint: { tenantId, fingerprint } } })

      if (existing) {
        // Mettre à jour si l'alerte existe et n'est pas résolue manuellement récemment
        if (existing.status !== 'resolved' ||
            (existing.resolvedAt && (now.getTime() - existing.resolvedAt.getTime()) > 300000)) {
          await prisma.alert.update({
            where: { tenantId_fingerprint: { tenantId, fingerprint } },
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
    } catch (e: any) {
      // P2002: concurrent request created this row between our findUnique and create.
      // The row exists — nothing to do on this tick; next poll will update normally.
      if (e?.code === 'P2002') continue
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

export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const prisma = await getSessionPrisma()
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const userId = session.user.id
    const tenantId = (session as any).user?.tenantId || 'default'

    // vDC scope: restrict dashboard to tenant's vDC resources
    const vdcScope = await getVdcScope(tenantId)

    // Thresholds configurés par l'utilisateur (via Settings > Alert thresholds)
    // Stockés localement en SQLite, fonctionne sans orchestrator (Community + Enterprise).
    const thresholds = {
      cpu_warning: 80,
      cpu_critical: 90,
      memory_warning: 80,
      memory_critical: 90,
      storage_warning: 80,
      storage_critical: 90,
    }
    try {
      const stored = await getSetting<any>('alert_thresholds', tenantId)
      if (stored && typeof stored === 'object') {
        for (const k of ['cpu_warning', 'cpu_critical', 'memory_warning', 'memory_critical', 'storage_warning', 'storage_critical'] as const) {
          if (typeof stored[k] === 'number') thresholds[k] = stored[k]
        }
      }
    } catch {
      // Pas de config stockée, on garde les défauts
    }

    // Récupérer toutes les connexions (PVE et PBS) en une seule requête
    const allConnections = await prisma.connection.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, type: true, hasCeph: true },
    })

    let pveConnections = allConnections.filter(c => c.type === 'pve')
    const pbsConnections = allConnections.filter(c => c.type === 'pbs')

    // If vDC scope is active, only fetch PVE connections that have vDCs for this tenant
    if (vdcScope) {
      pveConnections = pveConnections.filter(c => vdcScope.connectionIds.has(c.id))
    }

    // ============================================
    // CHARGER PVE ET PBS EN PARALLÈLE
    // ============================================
    const [pveResults, pbsResults] = await Promise.all([
      // PVE
      Promise.all(pveConnections.map(async (conn) => {
        try {
          const connData = await getConnectionById(conn.id)

          if (!connData.baseUrl || !connData.apiToken) return null

          const pveTimeout = { signal: AbortSignal.timeout(15000) }

          const [nodesResult, resourcesResult, statusResult, cephResult, storageConfigResult] = await Promise.allSettled([
            pveFetch<any[]>(connData, "/nodes", pveTimeout),
            pveFetch<any[]>(connData, "/cluster/resources", pveTimeout),
            pveFetch<any[]>(connData, "/cluster/status", pveTimeout),
            conn.hasCeph ? pveFetch<any>(connData, "/cluster/ceph/status", pveTimeout) : Promise.resolve(null),
            pveFetch<any[]>(connData, "/storage", pveTimeout),
          ])

          const nodes = nodesResult.status === 'fulfilled' ? nodesResult.value || [] : []
          const resources = resourcesResult.status === 'fulfilled' ? resourcesResult.value || [] : []
          const status = statusResult.status === 'fulfilled' ? statusResult.value || [] : []
          const cephStatus = cephResult.status === 'fulfilled' ? cephResult.value : null

          const clusterRow = status.find((x: any) => x?.type === "cluster")
          const clusterName = clusterRow?.name || conn.name || conn.id
          const quorumRow = status.find((x: any) => x?.type === "quorum" || x?.quorate !== undefined)

          const storageConfigs = storageConfigResult.status === 'fulfilled' ? storageConfigResult.value || [] : []

          const vms = resources.filter((r: any) => r.type === 'qemu')
          const lxcs = resources.filter((r: any) => r.type === 'lxc')

          // Aggregate real storage from /cluster/resources (not rootfs)
          const storageResources = resources.filter((r: any) => r.type === 'storage')
          const sharedTypes = new Set(['cephfs', 'rbd', 'nfs', 'cifs', 'glusterfs', 'iscsi', 'iscsidirect', 'pbs'])
          const storageConfigMap = new Map<string, any>()
          for (const cfg of storageConfigs) { if (cfg?.storage) storageConfigMap.set(cfg.storage, cfg) }

          const seenShared = new Set<string>()
          let connStorageUsed = 0, connStorageMax = 0
          for (const s of storageResources) {
            const cfg = storageConfigMap.get(s.storage)
            const sType = cfg?.type || ''
            const isShared = cfg?.shared === 1 || sharedTypes.has(sType)
            if (isShared) {
              if (seenShared.has(s.storage)) continue
              seenShared.add(s.storage)
            }
            connStorageUsed += Number(s.disk || 0)
            connStorageMax += Number(s.maxdisk || 0)
          }

          // Node status en parallèle
          const nodeStatuses = await Promise.all(nodes.map(async (node: any) => {
            if (!node?.node || node.status !== 'online') {
              return { node: node.node, status: node.status, cpuCores: 0, cpuUsage: 0, memUsed: 0, memMax: 0, storageUsed: 0, storageMax: 0, uptime: 0 }
            }

            try {
              const nodeStatus = await pveFetch<any>(connData, `/nodes/${encodeURIComponent(node.node)}/status`, { signal: AbortSignal.timeout(10000) })
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

          return { conn, clusterName, isCluster: nodes.length > 1, quorum: quorumRow, nodes: nodeStatuses, vms, lxcs, cephStatus, connStorageUsed, connStorageMax }
        } catch (e) {
          console.error(`[dashboard] PVE error ${conn.id}:`, e)
          
return null
        }
      })),

      // PBS
      Promise.all(pbsConnections.map(async (conn) => {
        try {
          const connData = await getPbsConnectionById(conn.id)
          
          const pbsTimeout = { signal: AbortSignal.timeout(15000) }

          const [datastores, tasks] = await Promise.allSettled([
            pbsFetch<any[]>(connData, "/admin/datastore", pbsTimeout),
            pbsFetch<any[]>(connData, "/nodes/localhost/tasks?limit=200&typefilter=backup,verify,garbage_collection", pbsTimeout),
          ])

          const datastoreList = datastores.status === 'fulfilled' ? datastores.value || [] : []
          const taskList = tasks.status === 'fulfilled' ? tasks.value || [] : []

          // Stats des datastores + count snapshots last 24h in parallel
          const now = Date.now() / 1000
          const cutoff24h = now - 86400

          let backupsOk24h = 0
          let backupsTotal24h = 0

          const dsStats = await Promise.all(datastoreList.map(async (ds: any) => {
            const storeName = ds.store || ds.name

            if (!storeName) return null

            try {
              const [dsStatus, snapshots] = await Promise.allSettled([
                pbsFetch<any>(connData, `/admin/datastore/${encodeURIComponent(storeName)}/status`, { signal: AbortSignal.timeout(10000) }),
                pbsFetch<any[]>(connData, `/admin/datastore/${encodeURIComponent(storeName)}/snapshots`, { signal: AbortSignal.timeout(10000) }),
              ])

              const status = dsStatus.status === 'fulfilled' ? dsStatus.value : null
              const snaps = snapshots.status === 'fulfilled' ? (snapshots.value || []) : []

              // Count snapshots created in the last 24h
              const recent = snaps.filter((s: any) => {
                const btime = s['backup-time'] || s.backup_time || s.ctime || 0
                return btime > cutoff24h
              })

              backupsTotal24h += recent.length
              // PBS snapshots that exist are successful (failed backups don't create snapshots)
              backupsOk24h += recent.length

              return {
                name: storeName,
                total: Number(status?.total || 0),
                used: Number(status?.used || 0),
                avail: Number(status?.avail || 0),
              }
            } catch { return null }
          }))

          const validDsStats = dsStats.filter(Boolean)
          let totalSize = 0, totalUsed = 0

          for (const ds of validDsStats) {
            if (ds) { totalSize += ds.total; totalUsed += ds.used }
          }

          // Count failed backup tasks from task log (tasks with status !== OK)
          const last24h = taskList.filter((t: any) => t.starttime && t.starttime > cutoff24h)
          const failedBackupTasks = last24h.filter((t: any) =>
            (t.worker_type === 'backup') && t.status && t.status !== 'OK'
          )
          const verifyTasks = last24h.filter((t: any) => t.worker_type === 'verify')

          // Add failed tasks to total (they don't create snapshots)
          backupsTotal24h += failedBackupTasks.length

          return {
            conn,
            datastoreCount: datastoreList.length,
            totalSize,
            totalUsed,
            usagePct: totalSize > 0 ? round1((totalUsed / totalSize) * 100) : 0,
            datastores: validDsStats,
            tasks: {
              backup: { total: backupsTotal24h, ok: backupsOk24h, error: failedBackupTasks.length },
              verify: { total: verifyTasks.length, ok: verifyTasks.filter((t: any) => t.status === 'OK').length, error: verifyTasks.filter((t: any) => t.status && t.status !== 'OK').length },
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

    let totalClusters = 0
    const allVms: any[] = [], allLxcs: any[] = [], allNodes: any[] = [], clusterInfos: any[] = []
    let cephGlobal: any = null
    const cephClusters: any[] = []
    let globalStorageUsed = 0, globalStorageMax = 0

    for (const data of validPve) {
      if (data.isCluster) totalClusters++

      // vDC filtering: restrict nodes and guests to what the tenant's vDCs allow
      const allowedNodes = vdcScope?.nodesByConnection.get(data.conn.id)
      const allowedPools = vdcScope?.poolsByConnection.get(data.conn.id)

      // Filter nodes by vDC scope (when scope is active, only keep allowed nodes)
      const scopedNodes = vdcScope
        ? data.nodes.filter((n: any) => allowedNodes?.has(n.node))
        : data.nodes

      // Filter VMs/LXCs by vDC pool membership
      const scopedVms = vdcScope
        ? data.vms.filter((vm: any) => {
            const pool = vm.pool
            if (!pool || pool === '') return false
            return allowedPools?.has(pool) ?? false
          })
        : data.vms
      const scopedLxcs = vdcScope
        ? data.lxcs.filter((lxc: any) => {
            const pool = lxc.pool
            if (!pool || pool === '') return false
            return allowedPools?.has(pool) ?? false
          })
        : data.lxcs

      // Aggregate real storage per connection
      globalStorageUsed += data.connStorageUsed || 0
      globalStorageMax += data.connStorageMax || 0

      for (const node of scopedNodes) {
        allNodes.push({
          connId: data.conn.id, node: node.node,
          name: node.node, connection: data.conn.name || data.conn.id, connectionId: data.conn.id,
          status: node.status, cpuPct: round1(node.cpuUsage * 100),
          memPct: node.memMax > 0 ? round1((node.memUsed / node.memMax) * 100) : 0, uptime: node.uptime,
          _cpuCores: node.cpuCores, _cpuUsage: node.cpuUsage, _memUsed: node.memUsed, _memMax: node.memMax, _storageUsed: node.storageUsed, _storageMax: node.storageMax,
        })
      }

      for (const vm of scopedVms) allVms.push({ ...vm, connId: data.conn.id, connection: data.conn.name, connectionId: data.conn.id })
      for (const lxc of scopedLxcs) allLxcs.push({ ...lxc, connId: data.conn.id, connection: data.conn.name, connectionId: data.conn.id })

      clusterInfos.push({
        id: data.conn.id, name: data.clusterName, isCluster: data.isCluster, nodes: scopedNodes.length,
        onlineNodes: scopedNodes.filter((n: any) => n.status === 'online').length,
        quorum: data.quorum ? { quorate: data.quorum.quorate, votes: data.quorum.votes, expected_votes: data.quorum.expected_votes } : null,
        cephHealth: data.cephStatus?.health?.status || null,
      })

      if (data.cephStatus) {
        const pgmap = data.cephStatus?.pgmap || {}
        const osdmap = data.cephStatus?.osdmap?.osdmap || data.cephStatus?.osdmap || {}

        const cephData = {
          available: true, health: data.cephStatus?.health?.status || 'UNKNOWN',
          osdsTotal: Number(osdmap?.num_osds || 0), osdsUp: Number(osdmap?.num_up_osds || 0), osdsIn: Number(osdmap?.num_in_osds || 0),
          pgsTotal: Number(pgmap?.num_pgs || 0), bytesTotal: Number(pgmap?.bytes_total || 0), bytesUsed: Number(pgmap?.bytes_used || 0),
          usedPct: pgmap?.bytes_total > 0 ? round1((Number(pgmap?.bytes_used || 0) / Number(pgmap?.bytes_total)) * 100) : 0,
          readBps: Number(pgmap?.read_bytes_sec || 0), writeBps: Number(pgmap?.write_bytes_sec || 0),
          healthChecks: data.cephStatus?.health?.checks || {},
        }

        // Only include real Ceph clusters (multi-node with actual OSDs)
        if (data.isCluster && cephData.osdsTotal > 0 && cephData.health !== 'UNKNOWN') {
          if (!cephGlobal) cephGlobal = cephData
          cephClusters.push({ connId: data.conn.id, name: data.clusterName, ...cephData })
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
        verifyTotal: data.tasks.verify.total, verifyOk: data.tasks.verify.ok, verifyError: data.tasks.verify.error,
      })

      for (const err of data.recentErrors) {
        pbsRecentErrors.push({ ...err, server: data.conn.name })
      }
    }

    // ============================================
    // ALERTES (PVE + PBS) avec contexte complet
    // ============================================
    const alerts: any[] = []

    // Alertes PVE - Nodes
    for (const node of allNodes) {
      if (node.status !== 'online') {
        alerts.push({
          severity: 'crit',
          message: `Node ${node.name}: OFFLINE`,
          i18nKey: 'alerts.messages.nodeOffline',
          i18nParams: { node: node.name },
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          connId: node.connId,
          metric: 'status',
          time: new Date().toISOString()
        })
      }

      if (node.memPct > thresholds.memory_critical) {
        alerts.push({
          severity: 'crit',
          message: `Node ${node.name}: RAM critical (${node.memPct}%)`,
          i18nKey: 'alerts.messages.ramCritical',
          i18nParams: { node: node.name, value: node.memPct },
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          connId: node.connId,
          metric: 'ram',
          currentValue: node.memPct,
          threshold: thresholds.memory_critical,
          time: new Date().toISOString()
        })
      } else if (node.memPct > thresholds.memory_warning) {
        alerts.push({
          severity: 'warn',
          message: `Node ${node.name}: RAM high (${node.memPct}%)`,
          i18nKey: 'alerts.messages.ramHigh',
          i18nParams: { node: node.name, value: node.memPct },
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          connId: node.connId,
          metric: 'ram',
          currentValue: node.memPct,
          threshold: thresholds.memory_warning,
          time: new Date().toISOString()
        })
      }

      if (node.cpuPct > thresholds.cpu_critical) {
        alerts.push({
          severity: 'crit',
          message: `Node ${node.name}: CPU critical (${node.cpuPct}%)`,
          i18nKey: 'alerts.messages.cpuCritical',
          i18nParams: { node: node.name, value: node.cpuPct },
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          connId: node.connId,
          metric: 'cpu',
          currentValue: node.cpuPct,
          threshold: thresholds.cpu_critical,
          time: new Date().toISOString()
        })
      } else if (node.cpuPct > thresholds.cpu_warning) {
        alerts.push({
          severity: 'warn',
          message: `Node ${node.name}: CPU high (${node.cpuPct}%)`,
          i18nKey: 'alerts.messages.cpuHigh',
          i18nParams: { node: node.name, value: node.cpuPct },
          source: node.connection,
          sourceType: 'pve',
          entityType: 'node',
          entityId: node.name,
          entityName: node.name,
          connId: node.connId,
          metric: 'cpu',
          currentValue: node.cpuPct,
          threshold: thresholds.cpu_warning,
          time: new Date().toISOString()
        })
      }
    }

    // Alertes Ceph — par cluster
    for (const cluster of clusterInfos) {
      if (cluster.cephHealth && cluster.cephHealth !== 'HEALTH_OK') {
        alerts.push({
          severity: cluster.cephHealth === 'HEALTH_WARN' ? 'warn' : 'crit',
          message: `Ceph ${cluster.name}: ${cluster.cephHealth}`,
          i18nKey: 'alerts.messages.cephHealth',
          i18nParams: { cluster: cluster.name, status: cluster.cephHealth },
          source: cluster.name,
          sourceType: 'ceph',
          entityType: 'cluster',
          entityId: cluster.id,
          entityName: cluster.name,
          connId: cluster.id,
          metric: 'health',
          time: new Date().toISOString()
        })
      }
    }

    // Alertes Quorum
    for (const cluster of clusterInfos) {
      if (cluster.quorum && !cluster.quorum.quorate) {
        alerts.push({
          severity: 'crit',
          message: `Cluster ${cluster.name}: Quorum lost!`,
          i18nKey: 'alerts.messages.quorumLost',
          i18nParams: { cluster: cluster.name },
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
      if (pbs.usagePct > thresholds.storage_critical) {
        alerts.push({
          severity: 'crit',
          message: `PBS ${pbs.name}: Storage critical (${pbs.usagePct}%)`,
          i18nKey: 'alerts.messages.pbsStorageCritical',
          i18nParams: { server: pbs.name, value: pbs.usagePct },
          source: pbs.name,
          sourceType: 'pbs',
          entityType: 'server',
          entityId: pbs.id,
          entityName: pbs.name,
          metric: 'storage',
          currentValue: pbs.usagePct,
          threshold: thresholds.storage_critical,
          time: new Date().toISOString()
        })
      } else if (pbs.usagePct > thresholds.storage_warning) {
        alerts.push({
          severity: 'warn',
          message: `PBS ${pbs.name}: Storage high (${pbs.usagePct}%)`,
          i18nKey: 'alerts.messages.pbsStorageHigh',
          i18nParams: { server: pbs.name, value: pbs.usagePct },
          source: pbs.name,
          sourceType: 'pbs',
          entityType: 'server',
          entityId: pbs.id,
          entityName: pbs.name,
          metric: 'storage',
          currentValue: pbs.usagePct,
          threshold: thresholds.storage_warning,
          time: new Date().toISOString()
        })
      }

      if (pbs.backupsError > 0) {
        alerts.push({
          severity: 'warn',
          message: `PBS ${pbs.name}: ${pbs.backupsError} backup(s) failed (24h)`,
          i18nKey: 'alerts.messages.pbsBackupFailed',
          i18nParams: { server: pbs.name, count: pbs.backupsError },
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

    // ============================================
    // RBAC FILTERING — scope data to user's permissions
    // ============================================
    const filteredVms = await filterVmsByPermission(userId, allVms, undefined, tenantId)
    const filteredLxcs = await filterVmsByPermission(userId, allLxcs, undefined, tenantId)
    const filteredNodes = await filterNodesByPermission(userId, allNodes, undefined, tenantId)

    // Recompute node-level aggregates from filtered nodes
    const fOnlineNodes = filteredNodes.filter((n: any) => n.status === 'online').length
    let fCpuCores = 0, fCpuUsed = 0, fMemUsed = 0, fMemMax = 0

    for (const n of filteredNodes as any[]) {
      fCpuCores += n._cpuCores || 0
      fCpuUsed += (n._cpuUsage || 0) * (n._cpuCores || 0)
      fMemUsed += n._memUsed || 0
      fMemMax += n._memMax || 0
    }

    // Compute provisioned resources (allocated to all VMs + LXCs, excluding templates)
    const allGuests = [...filteredVms, ...filteredLxcs].filter((g: any) => g.template !== 1)
    let provCpu = 0, provMem = 0, provDisk = 0
    for (const g of allGuests) {
      provCpu += Number(g.maxcpu || 0)
      provMem += Number(g.maxmem || 0)
      provDisk += Number(g.maxdisk || 0)
    }

    // RBAC scope-aware resource view:
    //   - infra scopes (global/connection/node) → gauges from nodes (current
    //     behavior). Provisioned bars show allocation against cluster capacity.
    //   - non-infra scopes (tag/pool/vm) → no nodes are accessible, so we
    //     aggregate from the user's VMs+LXCs instead. CPU is a weighted
    //     average of utilization, RAM/Storage are sums across guests. The
    //     "provisioned vs capacity" bars are zeroed since capacity has no
    //     meaning here.
    const useVmAggregates = filteredNodes.length === 0 && allGuests.length > 0

    let fCpuPct: number, fRamPct: number, fStoragePct: number
    let outCpuCores: number, outMemUsed: number, outMemMax: number
    let outStorageUsed: number, outStorageMax: number
    let provCpuPct: number, provMemPct: number, provStoragePct: number

    if (useVmAggregates) {
      let sumCpuUsed = 0, sumMaxCpu = 0
      let sumMemUsed = 0, sumMaxMem = 0
      let sumDiskUsed = 0, sumMaxDisk = 0

      for (const g of allGuests as any[]) {
        const cores = Number(g.maxcpu || 0)
        sumMaxCpu += cores
        // PVE reports cpu as 0..1 utilization of allocated cores
        if (g.status === 'running') sumCpuUsed += Number(g.cpu || 0) * cores
        sumMemUsed += Number(g.mem || 0)
        sumMaxMem += Number(g.maxmem || 0)
        sumDiskUsed += Number(g.disk || 0)
        sumMaxDisk += Number(g.maxdisk || 0)
      }

      outCpuCores = sumMaxCpu
      fCpuPct = sumMaxCpu > 0 ? round1((sumCpuUsed / sumMaxCpu) * 100) : 0
      outMemUsed = sumMemUsed
      outMemMax = sumMaxMem
      fRamPct = sumMaxMem > 0 ? round1((sumMemUsed / sumMaxMem) * 100) : 0
      outStorageUsed = sumDiskUsed
      outStorageMax = sumMaxDisk
      fStoragePct = sumMaxDisk > 0 ? round1((sumDiskUsed / sumMaxDisk) * 100) : 0
      // No cluster capacity to compare against — skip provisioned bars.
      provCpuPct = 0
      provMemPct = 0
      provStoragePct = 0
    } else {
      outCpuCores = fCpuCores
      fCpuPct = fCpuCores > 0 ? round1((fCpuUsed / fCpuCores) * 100) : 0
      outMemUsed = fMemUsed
      outMemMax = fMemMax
      fRamPct = fMemMax > 0 ? round1((fMemUsed / fMemMax) * 100) : 0
      // Use real storage pool data aggregated from /cluster/resources (not rootfs)
      outStorageUsed = globalStorageUsed
      outStorageMax = globalStorageMax
      fStoragePct = outStorageMax > 0 ? round1((outStorageUsed / outStorageMax) * 100) : 0
      provCpuPct = fCpuCores > 0 ? round1((provCpu / fCpuCores) * 100) : 0
      provMemPct = fMemMax > 0 ? round1((provMem / fMemMax) * 100) : 0
      provStoragePct = outStorageMax > 0 ? round1((provDisk / outStorageMax) * 100) : 0
    }

    // Recompute VM/LXC stats from filtered lists
    const fVmsTemplates = filteredVms.filter((v: any) => v.template === 1).length
    const fVmsRunning = filteredVms.filter((v: any) => v.status === 'running' && v.template !== 1).length
    const fVmsStopped = filteredVms.filter((v: any) => v.status === 'stopped' && v.template !== 1).length
    const fLxcRunning = filteredLxcs.filter((l: any) => l.status === 'running').length
    const fLxcStopped = filteredLxcs.filter((l: any) => l.status === 'stopped').length

    // Recompute top consumers from filtered VMs
    const fRunningVms = filteredVms.filter((v: any) => v.status === 'running')
    const fTopCpu = fRunningVms.map((v: any) => ({ name: v.name || `VM ${v.vmid}`, vmid: v.vmid, node: v.node, connId: v.connectionId || v.connId, type: v.type || 'qemu', value: round1(Number(v.cpu || 0) * 100) })).sort((a: any, b: any) => b.value - a.value).slice(0, 10)
    const fTopRam = fRunningVms.map((v: any) => { const used = Number(v.mem || 0), max = Number(v.maxmem || 0); return { name: v.name || `VM ${v.vmid}`, vmid: v.vmid, node: v.node, connId: v.connectionId || v.connId, type: v.type || 'qemu', value: max > 0 ? round1((used / max) * 100) : 0 } }).sort((a: any, b: any) => b.value - a.value).slice(0, 10)

    // Merge orchestrator alerts in (Enterprise only) + drop muted entries.
    // All logic lives in lib/alerts/dashboardAlertMerge.ts for testability.
    let orchAlerts: any[] | undefined
    if (process.env.ORCHESTRATOR_URL) {
      try {
        const orchResponse = await alertsApi.getAlerts({ status: 'active', limit: 100 })
        const orchData = orchResponse.data as any
        orchAlerts = orchData?.data || (Array.isArray(orchData) ? orchData : [])
      } catch {
        // Silently ignore orchestrator errors — not critical for dashboard
      }
    }
    const visibleNodeNames = new Set<string>(filteredNodes.map((n: any) => n.name))
    const filteredAlerts = mergeAndFilterDashboardAlerts({
      baseAlerts: alerts,
      orchAlerts,
      connectionNameById: new Map(allConnections.map(c => [c.id, c.name])),
      visibleNodeNames,
      hasVisibleNodes: filteredNodes.length > 0,
      silencedFingerprints: await loadActiveSilenceFingerprints(await getSessionPrisma()),
    })

    return NextResponse.json({
      data: {
        summary: {
          clusters: totalClusters, standalones: pveConnections.length - totalClusters,
          nodes: filteredNodes.length, nodesOnline: fOnlineNodes, nodesOffline: filteredNodes.length - fOnlineNodes,
          vmsRunning: fVmsRunning, vmsTotal: filteredVms.length - fVmsTemplates, lxcRunning: fLxcRunning, lxcTotal: filteredLxcs.length,
          cpuPct: fCpuPct, ramPct: fRamPct,
        },
        clusters: clusterInfos,
        nodes: filteredNodes,
        guests: {
          vms: { total: filteredVms.length - fVmsTemplates, running: fVmsRunning, stopped: fVmsStopped, templates: fVmsTemplates },
          lxc: { total: filteredLxcs.length, running: fLxcRunning, stopped: fLxcStopped },
        },
        vmList: filteredVms.map((vm: any) => ({
          id: `${vm.connectionId}-${vm.node}-${vm.vmid}`,
          connId: vm.connectionId,
          connName: vm.connection,
          node: vm.node,
          vmid: vm.vmid,
          name: vm.name,
          type: 'qemu' as const,
          status: vm.status,
          cpu: vm.cpu,
          mem: vm.mem,
          maxmem: vm.maxmem,
          template: vm.template === 1,
        })),
        lxcList: filteredLxcs.map((lxc: any) => ({
          id: `${lxc.connectionId}-${lxc.node}-${lxc.vmid}`,
          connId: lxc.connectionId,
          connName: lxc.connection,
          node: lxc.node,
          vmid: lxc.vmid,
          name: lxc.name,
          type: 'lxc' as const,
          status: lxc.status,
          cpu: lxc.cpu,
          mem: lxc.mem,
          maxmem: lxc.maxmem,
          template: lxc.template === 1,
        })),
        resources: {
          cpuCores: outCpuCores, cpuPct: fCpuPct,
          memUsed: outMemUsed, memMax: outMemMax, memUsedFormatted: formatBytes(outMemUsed), memMaxFormatted: formatBytes(outMemMax), ramPct: fRamPct,
          storageUsed: outStorageUsed, storageMax: outStorageMax, storageUsedFormatted: formatBytes(outStorageUsed), storageMaxFormatted: formatBytes(outStorageMax), storagePct: fStoragePct,
          provCpu, provCpuPct, provMem, provMemPct, provMemFormatted: formatBytes(provMem), provDisk, provStoragePct, provDiskFormatted: formatBytes(provDisk),
          scope: useVmAggregates ? 'vm' : 'cluster',
        },
        ceph: cephGlobal,
        cephClusters,
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
        alerts: filteredAlerts.slice(0, 20),
        alertsSummary: { crit: filteredAlerts.filter((a: any) => a.severity === 'crit').length, warn: filteredAlerts.filter((a: any) => a.severity === 'warn').length, info: filteredAlerts.filter((a: any) => a.severity === 'info').length },
        topCpu: fTopCpu,
        topRam: fTopRam,
        lastUpdated: new Date().toISOString(),
      }
    })
  } catch (e: any) {
    console.error("[dashboard] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
