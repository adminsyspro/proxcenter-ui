import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'

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
    'qmstart': 'Démarrage VM',
    'qmstop': 'Arrêt VM',
    'qmshutdown': 'Arrêt VM',
    'qmreboot': 'Redémarrage VM',
    'qmsuspend': 'Suspension VM',
    'qmresume': 'Reprise VM',
    'qmclone': 'Clone VM',
    'qmcreate': 'Création VM',
    'qmdestroy': 'Suppression VM',
    'qmmigrate': 'Migration VM',
    'qmigrate': 'Migration VM',  // Proxmox utilise qmigrate dans les tâches
    'qmrollback': 'Rollback VM',
    'qmsnapshot': 'Snapshot VM',
    'qmdelsnapshot': 'Suppression snapshot',
    'vzstart': 'Démarrage LXC',
    'vzstop': 'Arrêt LXC',
    'vzshutdown': 'Arrêt LXC',
    'vzreboot': 'Redémarrage LXC',
    'vzsuspend': 'Suspension LXC',
    'vzresume': 'Reprise LXC',
    'vzcreate': 'Création LXC',
    'vzdestroy': 'Suppression LXC',
    'vzmigrate': 'Migration LXC',
    'vzdump': 'Backup',
    'qmbackup': 'Backup VM',
    'vzbackup': 'Backup LXC',
    'vncproxy': 'Console VNC',
    'spiceproxy': 'Console SPICE',
    'startall': 'Démarrage tous',
    'stopall': 'Arrêt tous',
    'aptupdate': 'Mise à jour APT',
    'imgcopy': 'Copie image',
    'download': 'Téléchargement',
    'srvreload': 'Rechargement service',
    'srvrestart': 'Redémarrage service',
    'cephcreateosd': 'Création OSD Ceph',
    'cephdestroyosd': 'Suppression OSD Ceph',
    'ha-manager': 'HA Manager',
    'hamigrate': 'Migration HA',
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
    // Récupérer uniquement les connexions PVE
    const connections = await prisma.connection.findMany({
      where: { type: 'pve' }
    })
    
    if (connections.length === 0) {
      return NextResponse.json({ data: [], count: 0 })
    }

    const runningTasks: any[] = []

    // Pour chaque connexion, récupérer les tâches
    await Promise.all(
      connections.map(async (conn) => {
        try {
          const connection = await getConnectionById(conn.id)
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
          const running = tasks.filter(t => {
            // Si endtime existe, la tâche est terminée
            if (t.endtime) return false

            // Si status existe et n'est pas vide, la tâche est terminée
            if (t.status && t.status !== '') return false
            
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
