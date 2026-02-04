import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { decryptSecret } from "@/lib/crypto/secret"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
}

function parseVmKey(vmKey: string) {
  const parts = vmKey.split(':')

  if (parts.length !== 4) {
    throw new Error('Invalid vmKey format. Expected connId:type:node:vmid')
  }

  
return {
    connId: parts[0],
    type: parts[1],
    node: parts[2],
    vmid: parts[3],
  }
}

async function getConnection(id: string) {
  const connection = await prisma.connection.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      baseUrl: true,
      insecureTLS: true,
      apiTokenEnc: true,
    }
  })

  if (!connection || !connection.apiTokenEnc) {
    return null
  }

  return {
    id: connection.id,
    name: connection.name,
    baseUrl: connection.baseUrl,
    apiToken: decryptSecret(connection.apiTokenEnc),
    insecureDev: !!connection.insecureTLS,
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`

  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60

    
return `${m}m ${s}s`
  }

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)

  
return `${h}h ${m}m`
}

/**
 * GET /api/v1/guests/[vmid]/tasks
 * Liste les tâches récentes d'une VM
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/tasks`

    const queryParams = new URLSearchParams({
      vmid: vmid,
      limit: '50',
    })
    
    const tasks = await pveFetch<any[]>(conn, `${apiPath}?${queryParams}`)

    const typeLabels: Record<string, string> = {
      'qmstart': 'Démarrage',
      'qmstop': 'Arrêt',
      'qmshutdown': 'Arrêt propre',
      'qmreboot': 'Redémarrage',
      'qmsuspend': 'Mise en pause',
      'qmresume': 'Reprise',
      'qmreset': 'Reset',
      'qmmigrate': 'Migration',
      'qmclone': 'Clonage',
      'qmcreate': 'Création',
      'qmdestroy': 'Suppression',
      'qmsnapshot': 'Snapshot',
      'qmrollback': 'Rollback',
      'qmdelsnapshot': 'Suppr. snapshot',
      'qmconfig': 'Configuration',
      'vzdump': 'Sauvegarde',
      'vzstart': 'Démarrage CT',
      'vzstop': 'Arrêt CT',
      'vzshutdown': 'Arrêt propre CT',
      'vzmigrate': 'Migration CT',
      'vzclone': 'Clonage CT',
      'vzcreate': 'Création CT',
      'vzdestroy': 'Suppression CT',
      'vzsnapshot': 'Snapshot CT',
      'vzrollback': 'Rollback CT',
    }

    const formatted = (tasks || []).map(t => {
      let taskType = t.type || 'unknown'
      let taskLabel = typeLabels[taskType] || taskType

      let status = 'running'

      if (t.status) {
        if (t.status === 'OK') status = 'success'
        else if (t.status.startsWith('WARNINGS')) status = 'warning'
        else status = 'error'
      }

      return {
        upid: t.upid,
        type: taskType,
        label: taskLabel,
        status,
        statusText: t.status || 'En cours...',
        starttime: t.starttime || 0,
        starttimeFormatted: t.starttime 
          ? new Date(t.starttime * 1000).toLocaleString('fr-FR')
          : '-',
        endtime: t.endtime || null,
        endtimeFormatted: t.endtime 
          ? new Date(t.endtime * 1000).toLocaleString('fr-FR')
          : null,
        duration: t.endtime && t.starttime 
          ? t.endtime - t.starttime 
          : null,
        durationFormatted: t.endtime && t.starttime 
          ? formatDuration(t.endtime - t.starttime)
          : null,
        user: t.user || '-',
        node: t.node || node,
      }
    }).sort((a, b) => b.starttime - a.starttime)

    return NextResponse.json({
      data: {
        tasks: formatted,
        count: formatted.length,
      }
    })
  } catch (e: any) {
    console.error("Tasks list error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
