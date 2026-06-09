import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { getTenantConnectionIds } from "@/lib/tenant"
import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
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

function formatTaskType(type: string): string {
  const types: Record<string, string> = {
    'qmstart': 'Start VM',
    'qmstop': 'Stop VM',
    'qmshutdown': 'Shutdown VM',
    'qmreboot': 'Reboot VM',
    'qmsuspend': 'Suspend VM',
    'qmresume': 'Resume VM',
    'qmclone': 'Clone VM',
    'qmcreate': 'Create VM',
    'qmdestroy': 'Destroy VM',
    'qmmigrate': 'Migrate VM',
    'qmigrate': 'Migrate VM',
    'qmrollback': 'Rollback VM',
    'qmsnapshot': 'Snapshot VM',
    'qmdelsnapshot': 'Delete Snapshot',
    'vzstart': 'Start LXC',
    'vzstop': 'Stop LXC',
    'vzshutdown': 'Shutdown LXC',
    'vzreboot': 'Reboot LXC',
    'vzsuspend': 'Suspend LXC',
    'vzresume': 'Resume LXC',
    'vzcreate': 'Create LXC',
    'vzdestroy': 'Destroy LXC',
    'vzmigrate': 'Migrate LXC',
    'vzdump': 'Backup',
    'qmbackup': 'Backup VM',
    'vzbackup': 'Backup LXC',
    'vncproxy': 'VNC Console',
    'spiceproxy': 'SPICE Console',
    'startall': 'Start All',
    'stopall': 'Stop All',
    'aptupdate': 'APT Update',
    'imgcopy': 'Image Copy',
    'download': 'Download',
    'srvreload': 'Reload Service',
    'srvrestart': 'Restart Service',
    'cephcreateosd': 'Create Ceph OSD',
    'cephdestroyosd': 'Destroy Ceph OSD',
    'ha-manager': 'HA Manager',
    'hamigrate': 'HA Migrate',
  }

  
return types[type] || type
}

function getTaskIcon(type: string): string {
  if (type.includes('start') || type.includes('resume')) return 'ri-play-circle-line'
  if (type.includes('stop') || type.includes('shutdown')) return 'ri-stop-circle-line'
  if (type.includes('reboot')) return 'ri-restart-line'
  if (type.includes('clone')) return 'ri-file-copy-line'
  if (type.includes('create')) return 'ri-add-circle-line'
  if (type.includes('destroy')) return 'ri-delete-bin-line'
  if (type.includes('migrate')) return 'ri-swap-box-line'
  if (type.includes('snapshot')) return 'ri-camera-line'
  if (type.includes('backup') || type.includes('dump')) return 'ri-download-cloud-line'
  if (type.includes('vnc') || type.includes('spice')) return 'ri-terminal-box-line'
  if (type.includes('download')) return 'ri-download-line'
  if (type.includes('apt') || type.includes('update')) return 'ri-refresh-line'
  
return 'ri-loader-4-line'
}

// GET /api/v1/tasks/running - Récupère toutes les tâches en cours
export async function GET() {
  try {
    // connection.view baseline — tenants without tasks.view still get a
    // scoped view of their own nodes' running tasks via the vDC filter
    // below. Super admins see everything.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { getCurrentTenantId } = await import('@/lib/tenant')
    const { getTenantInfrastructureScope, maskingScope } = await import('@/lib/tenant/infraScope')
    const tenantId = await getCurrentTenantId()
    const vdcScope = maskingScope(await getTenantInfrastructureScope(tenantId))
    // For vDC tenants on shared-node clusters the node filter is a no-op
    // (every vDC has every node in scope). Pool-membership is the real
    // boundary — pull the live vmid set per connection.
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : null

    // Reachable connection IDs = directly owned ∪ vDC-bound. The previous
    // tenant-scoped prisma query returned an empty set in MSP mode (tenants
    // don't own connections directly), so the dropdown was permanently
    // empty for them — same bug as /changes and /orchestrator/alerts.
    const tenantConnectionIds = await getTenantConnectionIds()

    if (tenantConnectionIds.size === 0) {
      return NextResponse.json({ data: [], count: 0 })
    }

    // Use the global prisma (not tenant-scoped) since vDC-bound connections
    // are owned by the provider tenant; we still safety-filter against the
    // reachable set above.
    const connections = await prisma.connection.findMany({
      where: { type: 'pve', id: { in: Array.from(tenantConnectionIds) } },
    })

    if (connections.length === 0) {
      return NextResponse.json({ data: [], count: 0 })
    }

    const runningTasks: any[] = []

    // Pour chaque connexion, récupérer les tâches
    await Promise.all(
      connections.map(async (conn) => {
        try {
          const connection = await getConnectionById(conn.id, (conn as any).tenantId)
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
          } catch {
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
            } catch {}
          }

          // Filtrer uniquement les tâches en cours
          // Une tâche est "en cours" si elle n'a pas de endtime ET pas de status (ou status vide)
          const allowedNodes = vdcScope?.nodesByConnection.get(conn.id)
          const allowedVmids = vdcVmids?.get(conn.id)
          const running = tasks.filter(t => {
            if (t.endtime) return false
            if (t.status && t.status !== '') return false
            // Tenant scope: drop tasks whose node is outside the vDC's nodes.
            if (allowedNodes && t.node && !allowedNodes.has(t.node)) return false
            // vDC tenants on shared-node clusters need pool isolation:
            // VM tasks must target a vmid in the tenant's vDC pools;
            // non-VM tasks (cluster-wide, node-level) are provider-only.
            if (allowedVmids) {
              const vmid = extractTaskVmid(t.id)
              if (!vmid) return false
              if (!allowedVmids.has(vmid)) return false
            }

return true
          })
          
          for (const task of running) {
            const duration = Math.floor(Date.now() / 1000) - task.starttime

            runningTasks.push({
              id: task.upid,
              startTime: new Date(task.starttime * 1000).toISOString(),
              type: task.type,
              typeLabel: formatTaskType(task.type),
              icon: getTaskIcon(task.type),
              entity: task.id || null,
              node: task.node,
              user: task.user,
              durationSec: duration,
              connectionId: conn.id,
              connectionName: conn.name,
            })
          }
        } catch (e) {
          console.error(`Erreur connexion ${conn.name}:`, e)
        }
      })
    )

    // Trier par date de début (plus récent d'abord)
    runningTasks.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())

    return NextResponse.json({ 
      data: runningTasks,
      count: runningTasks.length
    })
  } catch (error: any) {
    console.error('Erreur API tasks/running:', error)
    
return NextResponse.json(
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}
