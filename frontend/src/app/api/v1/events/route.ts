import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { getSessionPrisma } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getTenantInfrastructureScope, inventoryConnectionPlan, maskingScope } from '@/lib/tenant/infraScope'
import { getVdcVmidsByConnection } from "@/lib/alerts/vdcVmids"
import { extractTaskVmid } from "@/lib/tasks/scope"

export const runtime = 'nodejs'

type ProxmoxTask = {
  upid: string
  node: string
  pid: number
  pstart: number
  starttime: number
  endtime?: number
  type: string
  id?: string
  user: string
  status?: string
}

type ProxmoxClusterLog = {
  uid: number
  time: number
  msg: string
  node: string
  pri: number
  tag: string
  pid?: number
  user?: string
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  
return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

function getTaskLevel(status?: string): 'info' | 'warning' | 'error' {
  if (!status) return 'info' // En cours
  if (status === 'OK') return 'info'
  if (status.includes('WARNINGS')) return 'warning'
  
return 'error'
}

function getLogLevel(pri: number): 'info' | 'warning' | 'error' {
  // Syslog priority: 0=emerg, 1=alert, 2=crit, 3=err, 4=warning, 5=notice, 6=info, 7=debug
  if (pri <= 3) return 'error'
  if (pri <= 4) return 'warning'
  
return 'info'
}

export async function GET(req: Request) {
  try {
    const sessionPrisma = await getSessionPrisma()
    // connection.view baseline — tenants get a scoped feed filtered by their
    // vDC's nodes below. Super admins (no scope) see everything.
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (permError) return permError

    const { getCurrentTenantId } = await import('@/lib/tenant')
    const tenantId = await getCurrentTenantId()

    // Resolve infrastructure scope: provider sees all connections, msp sees
    // tenant-owned, iaas is restricted to vDC-referenced connection ids.
    const infra = await getTenantInfrastructureScope(tenantId)
    const plan = inventoryConnectionPlan(infra)
    const vdcScope = maskingScope(infra)

    // Pool-level scope (shared-node MSP clusters need this on top of the
    // node filter, which collapses to a no-op when every vDC owns every
    // node).
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : null

    const { searchParams } = new URL(req.url)
    const limit = Math.min(Number.parseInt(searchParams.get('limit') || '100'), 500)
    const source = searchParams.get('source') || 'all' // 'tasks', 'logs', 'all'

    // Choose the connection client based on tenant kind: provider + iaas use
    // global (see all / filtered-by-id); msp uses the session client
    // (tenant-owned connections only).
    const connPrisma = plan.pveClient === 'global' ? globalPrisma : sessionPrisma
    const connWhere: any = { type: 'pve' }
    if (plan.pveConnectionIds) connWhere.id = { in: plan.pveConnectionIds }
    const connections = await connPrisma.connection.findMany({ where: connWhere })
    
    if (connections.length === 0) {
      return NextResponse.json({ data: [] })
    }

    const allEvents: any[] = []

    // Pour chaque connexion, récupérer les tâches et logs
    await Promise.all(
      connections.map(async (conn) => {
        try {
          const connection = await getConnectionById(conn.id, (conn as any).tenantId)

          // Récupérer les tâches
          if (source === 'all' || source === 'tasks') {
            let tasks: ProxmoxTask[] = []
            
            // Essayer d'abord /cluster/tasks (pour les clusters)
            try {
              const clusterTasks = await pveFetch<ProxmoxTask[]>(
                connection,
                `/cluster/tasks`
              )

              if (Array.isArray(clusterTasks)) {
                tasks = clusterTasks
              }
            } catch (clusterErr) {
              // Si /cluster/tasks échoue, essayer par node (pour standalone)
              try {
                const nodes = await pveFetch<{ node: string }[]>(connection, '/nodes')

                if (Array.isArray(nodes)) {
                  for (const nodeInfo of nodes) {
                    try {
                      const nodeTasks = await pveFetch<ProxmoxTask[]>(
                        connection,
                        `/nodes/${encodeURIComponent(nodeInfo.node)}/tasks`
                      )

                      if (Array.isArray(nodeTasks)) {
                        tasks.push(...nodeTasks)
                      }
                    } catch {}
                  }
                }
              } catch (nodeErr) {
                console.error(`Erreur nodes/tasks pour ${conn.name}:`, nodeErr)
              }
            }

            // Build VMID → name lookup from cluster resources
            const vmNameMap: Record<string, string> = {}
            try {
              const resources = await pveFetch<any[]>(connection, '/cluster/resources?type=vm')
              if (Array.isArray(resources)) {
                for (const r of resources) {
                  if (r.vmid != null && r.name) {
                    vmNameMap[String(r.vmid)] = r.name
                  }
                }
              }
            } catch {}

            // Tenant vDC scope: drop tasks that ran on a node outside the
            // tenant's authorised set. Super admin keeps the full list.
            const allowedNodes = vdcScope?.nodesByConnection.get(conn.id)
            if (allowedNodes) {
              tasks = tasks.filter(t => !t.node || allowedNodes.has(t.node))
            }
            // Pool-membership filter: on a shared-node cluster the node
            // filter above is a no-op, so apply vmid → vDC pool isolation.
            // VM tasks must target a tenant vmid; non-VM tasks (cluster /
            // node level, e.g. ceph, package updates) are provider-only.
            const allowedVmids = vdcVmids?.get(conn.id)
            if (allowedVmids) {
              tasks = tasks.filter(t => {
                const vmid = extractTaskVmid(t.id)
                if (!vmid) return false
                return allowedVmids.has(vmid)
              })
            }

            // Traiter les tâches - trier par date décroissante d'abord
            tasks.sort((a, b) => (b.starttime || 0) - (a.starttime || 0))
            const limitedTasks = tasks.slice(0, limit)

            for (const task of limitedTasks) {
              const duration = task.endtime
                ? task.endtime - task.starttime
                : Math.floor(Date.now() / 1000) - task.starttime

              const vmName = task.id ? vmNameMap[task.id] || null : null

              allEvents.push({
                id: task.upid,
                ts: new Date(task.starttime * 1000).toISOString(),
                endTs: task.endtime ? new Date(task.endtime * 1000).toISOString() : null,
                level: getTaskLevel(task.status),
                category: 'task',
                type: task.type,
                typeLabel: task.type,
                entity: task.id || task.node,
                entityName: vmName,
                node: task.node,
                user: task.user,
                status: task.status || 'running',
                duration: formatUptime(duration),
                durationSec: duration,
                message: `${task.type}${task.id ? ` (${vmName || task.id})` : ''} - ${task.status || 'running'}`,
                connectionId: conn.id,
                connectionName: conn.name,
                source: 'proxmox-task'
              })
            }
          }

          // Récupérer les logs (provider-only — they are cluster syslog
          // entries with no vmid scope, leaking them into vDC tenants
          // would surface neighbour activity).
          if ((source === 'all' || source === 'logs') && !vdcScope) {
            let logs: ProxmoxClusterLog[] = []
            
            // Essayer d'abord /cluster/log (pour les clusters)
            try {
              const clusterLogs = await pveFetch<ProxmoxClusterLog[]>(
                connection,
                `/cluster/log?max=${Math.min(limit, 200)}`
              )

              if (Array.isArray(clusterLogs)) {
                logs = clusterLogs
              }
            } catch {
              // Pour les standalone, pas de logs cluster disponibles
              // On pourrait ajouter /nodes/{node}/syslog mais c'est très verbeux
            }

            // Same tenant scope filter for cluster logs.
            const allowedNodesLogs = vdcScope?.nodesByConnection.get(conn.id)
            if (allowedNodesLogs) {
              logs = logs.filter(l => !l.node || allowedNodesLogs.has(l.node))
            }

            for (const log of logs) {
              allEvents.push({
                id: `${conn.id}-log-${log.uid}`,
                ts: new Date(log.time * 1000).toISOString(),
                level: getLogLevel(log.pri),
                category: 'log',
                type: log.tag,
                typeLabel: log.tag,
                entity: log.node,
                node: log.node,
                user: log.user || 'system',
                status: null,
                message: log.msg,
                connectionId: conn.id,
                connectionName: conn.name,
                source: 'proxmox-log'
              })
            }
          }
        } catch (e) {
          console.error(`Erreur connexion ${conn.name}:`, e)
        }
      })
    )

    // Trier par date décroissante
    allEvents.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())

    // Limiter le nombre de résultats
    const limitedEvents = allEvents.slice(0, limit)

    return NextResponse.json({ 
      data: limitedEvents,
      meta: {
        total: allEvents.length,
        returned: limitedEvents.length,
        connections: connections.length
      }
    })
  } catch (error: any) {
    console.error('Erreur API events:', error)
    
return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}
