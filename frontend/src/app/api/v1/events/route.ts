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
  
return `${Math.floor(seconds / 86400)}j ${Math.floor((seconds % 86400) / 3600)}h`
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

function formatTaskType(type: string): string {
  const types: Record<string, string> = {
    'qmstart': 'Démarrage VM',
    'qmstop': 'Arrêt VM',
    'qmshutdown': 'Arrêt VM (graceful)',
    'qmreboot': 'Redémarrage VM',
    'qmsuspend': 'Suspension VM',
    'qmresume': 'Reprise VM',
    'qmclone': 'Clone VM',
    'qmcreate': 'Création VM',
    'qmdestroy': 'Suppression VM',
    'qmmigrate': 'Migration VM',
    'qmrollback': 'Rollback VM',
    'qmsnapshot': 'Snapshot VM',
    'qmdelsnapshot': 'Suppression snapshot VM',
    'vzstart': 'Démarrage LXC',
    'vzstop': 'Arrêt LXC',
    'vzshutdown': 'Arrêt LXC (graceful)',
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
  }

  
return types[type] || type
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
    const source = searchParams.get('source') || 'all' // 'tasks', 'logs', 'all'

    // Récupérer uniquement les connexions PVE (pas PBS)
    const connections = await prisma.connection.findMany({
      where: { type: 'pve' }
    })
    
    if (connections.length === 0) {
      return NextResponse.json({ data: [] })
    }

    const allEvents: any[] = []

    // Pour chaque connexion, récupérer les tâches et logs
    await Promise.all(
      connections.map(async (conn) => {
        try {
          const connection = await getConnectionById(conn.id)

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

            // Traiter les tâches - trier par date décroissante d'abord
            tasks.sort((a, b) => (b.starttime || 0) - (a.starttime || 0))
            const limitedTasks = tasks.slice(0, limit)

            for (const task of limitedTasks) {
              const duration = task.endtime 
                ? task.endtime - task.starttime 
                : Math.floor(Date.now() / 1000) - task.starttime

              allEvents.push({
                id: task.upid,
                ts: new Date(task.starttime * 1000).toISOString(),
                endTs: task.endtime ? new Date(task.endtime * 1000).toISOString() : null,
                level: getTaskLevel(task.status),
                category: 'task',
                type: task.type,
                typeLabel: formatTaskType(task.type),
                entity: task.id || task.node,
                node: task.node,
                user: task.user,
                status: task.status || 'running',
                duration: formatUptime(duration),
                durationSec: duration,
                message: `${formatTaskType(task.type)}${task.id ? ` (${task.id})` : ''} - ${task.status || 'En cours...'}`,
                connectionId: conn.id,
                connectionName: conn.name,
                source: 'proxmox-task'
              })
            }
          }

          // Récupérer les logs
          if (source === 'all' || source === 'logs') {
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
      { error: error?.message || 'Erreur serveur' },
      { status: 500 }
    )
  }
}
