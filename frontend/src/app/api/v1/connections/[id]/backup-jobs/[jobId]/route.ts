import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>
}

/**
 * GET /api/v1/connections/[id]/backup-jobs/[jobId]
 * 
 * Récupère les détails d'un backup job
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id, jobId } = await ctx.params

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // RBAC check - permission de voir les backup jobs
    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_VIEW, "connection", id)

    if (denied) return denied

    const conn = await getConnectionById(id)
    
    const job = await pveFetch<any>(conn, `/cluster/backup/${encodeURIComponent(jobId)}`)

    return NextResponse.json({ data: job })
  } catch (e: any) {
    console.error("[backup-jobs] GET Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PUT /api/v1/connections/[id]/backup-jobs/[jobId]
 * 
 * Modifie un backup job existant
 */
export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const { id, jobId } = await ctx.params
    const body = await req.json()

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // RBAC check - permission de modifier les backup jobs
    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_EDIT, "connection", id)

    if (denied) return denied

    const conn = await getConnectionById(id)
    
    // Construire les paramètres
    const params = new URLSearchParams()
    
    // Storage
    if (body.storage) {
      params.set('storage', body.storage)
    }
    
    // Schedule
    if (body.schedule !== undefined) {
      params.set('schedule', body.schedule)
    }
    
    // Node
    if (body.node !== undefined) {
      if (body.node) {
        params.set('node', body.node)
      } else {
        params.set('delete', 'node')
      }
    }
    
    // Mode
    if (body.mode) {
      params.set('mode', body.mode)
    }
    
    // Compression
    if (body.compress) {
      params.set('compress', body.compress)
    }
    
    // Sélection des VMs
    if (body.selectionMode === 'all') {
      params.set('all', '1')

      // Supprimer vmid si présent
      params.append('delete', 'vmid')
      params.append('delete', 'pool')

      if (body.excludedVmids && body.excludedVmids.length > 0) {
        params.set('exclude', body.excludedVmids.join(','))
      } else {
        params.append('delete', 'exclude')
      }
    } else if (body.selectionMode === 'include') {
      params.set('all', '0')
      params.append('delete', 'pool')
      params.append('delete', 'exclude')

      if (body.vmids?.length > 0) {
        params.set('vmid', body.vmids.join(','))
      }
    } else if (body.selectionMode === 'pool') {
      params.set('all', '0')
      params.append('delete', 'vmid')
      params.append('delete', 'exclude')

      if (body.pool) {
        params.set('pool', body.pool)
      }
    }
    
    // Enabled
    if (body.enabled !== undefined) {
      params.set('enabled', body.enabled ? '1' : '0')
    }
    
    // Commentaire
    if (body.comment !== undefined) {
      if (body.comment) {
        params.set('comment', body.comment)
      } else {
        params.append('delete', 'comment')
      }
    }
    
    // Mail
    if (body.mailto !== undefined) {
      if (body.mailto) {
        params.set('mailto', body.mailto)
      } else {
        params.append('delete', 'mailto')
      }
    }

    if (body.mailnotification) {
      params.set('mailnotification', body.mailnotification)
    }

    // Notification mode
    if (body.notificationMode) {
      params.set('notification-mode', body.notificationMode)
    }

    // Retention (prune-backups)
    if (!body.keepAll) {
      const parts: string[] = []
      if (body.keepLast) parts.push(`keep-last=${body.keepLast}`)
      if (body.keepHourly) parts.push(`keep-hourly=${body.keepHourly}`)
      if (body.keepDaily) parts.push(`keep-daily=${body.keepDaily}`)
      if (body.keepWeekly) parts.push(`keep-weekly=${body.keepWeekly}`)
      if (body.keepMonthly) parts.push(`keep-monthly=${body.keepMonthly}`)
      if (body.keepYearly) parts.push(`keep-yearly=${body.keepYearly}`)
      if (parts.length > 0) {
        params.set('prune-backups', parts.join(','))
      }
    }

    if (body.maxfiles !== undefined) {
      params.set('maxfiles', String(body.maxfiles))
    }

    // Note template
    if (body.notesTemplate) {
      params.set('notes-template', body.notesTemplate)
    }

    // Advanced options — only set if they have a value, never delete (PVE rejects delete for unknown options)
    if (body.bwlimit) params.set('bwlimit', body.bwlimit)
    if (body.zstd) params.set('zstd', body.zstd)
    if (body.ioWorkers) params.set('io-workers', body.ioWorkers)

    if (body.fleecing) {
      const fleeceParts = ['enabled=1']
      if (body.fleecingStorage) fleeceParts.push(`storage=${body.fleecingStorage}`)
      params.set('fleecing', fleeceParts.join(','))
    }

    if (body.repeatMissed !== undefined) {
      params.set('repeat-missed', body.repeatMissed ? '1' : '0')
    }

    if (body.pbsChangeDetectionMode && body.pbsChangeDetectionMode !== 'default') {
      params.set('pbs-change-detection-mode', body.pbsChangeDetectionMode)
    }

    // Mettre à jour
    const result = await pveFetch<any>(conn, `/cluster/backup/${encodeURIComponent(jobId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })

    return NextResponse.json({ 
      data: result,
      message: 'Backup job updated successfully'
    })
  } catch (e: any) {
    console.error("[backup-jobs] PUT Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/connections/[id]/backup-jobs/[jobId]
 * 
 * Supprime un backup job
 */
export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const { id, jobId } = await ctx.params

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // RBAC check - permission de supprimer les backup jobs
    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_DELETE, "connection", id)

    if (denied) return denied

    const conn = await getConnectionById(id)
    
    await pveFetch<any>(conn, `/cluster/backup/${encodeURIComponent(jobId)}`, {
      method: 'DELETE'
    })

    return NextResponse.json({ 
      message: 'Backup job deleted successfully'
    })
  } catch (e: any) {
    console.error("[backup-jobs] DELETE Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/connections/[id]/backup-jobs/[jobId]
 * 
 * Exécute immédiatement un backup job
 * Action: run
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const { id, jobId } = await ctx.params
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    // RBAC check - permission d'exécuter les backup jobs
    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_RUN, "connection", id)

    if (denied) return denied

    const conn = await getConnectionById(id)
    
    if (action === 'run') {
      // Exécuter le job immédiatement
      // Note: Proxmox n'a pas d'endpoint direct pour ça, on doit utiliser vzdump
      // avec les mêmes paramètres que le job
      const job = await pveFetch<any>(conn, `/cluster/backup/${encodeURIComponent(jobId)}`)
      
      // Construire la commande vzdump
      const params = new URLSearchParams()

      params.set('storage', job.storage)
      if (job.mode) params.set('mode', job.mode)
      if (job.compress) params.set('compress', job.compress)
      
      // VMs à sauvegarder
      if (job.all) {
        params.set('all', '1')
        if (job.exclude) params.set('exclude', job.exclude)
      } else if (job.vmid) {
        params.set('vmid', job.vmid)
      } else if (job.pool) {
        params.set('pool', job.pool)
      }
      
      // Déterminer le node (si spécifié ou premier node disponible)
      const targetNode = job.node || (await pveFetch<any[]>(conn, `/nodes`))?.[0]?.node
      
      if (!targetNode) {
        return NextResponse.json({ error: "No node available" }, { status: 400 })
      }
      
      const result = await pveFetch<any>(conn, `/nodes/${encodeURIComponent(targetNode)}/vzdump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      })
      
      return NextResponse.json({ 
        data: result,
        message: 'Backup job started'
      })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (e: any) {
    console.error("[backup-jobs] POST Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
