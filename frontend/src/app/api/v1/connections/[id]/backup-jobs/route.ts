import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/v1/connections/[id]/backup-jobs
 * 
 * Récupère la liste des backup jobs configurés sur le cluster Proxmox
 * Endpoint Proxmox: GET /cluster/backup
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params

    if (!id) {
      return NextResponse.json({ error: "Missing connection ID" }, { status: 400 })
    }

    // RBAC check - permission de voir les backup jobs
    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_VIEW, "connection", id)

    if (denied) return denied

    const conn = await getConnectionById(id)
    
    // Récupérer les backup jobs
    const jobs = await pveFetch<any[]>(conn, `/cluster/backup`)
    
    // Récupérer les storages disponibles pour les backups
    const storages = await pveFetch<any[]>(conn, `/storage`)


    // Filtrer uniquement les storages de type PBS ou qui supportent les backups
    const backupStorages = (storages || []).filter(s => 
      s.type === 'pbs' || // Proxmox Backup Server
      (s.content?.includes('backup') && s.type !== 'dir' && s.type !== 'nfs' && s.type !== 'cifs') // Autres storages backup mais pas locaux
    )


    // Aussi retourner tous les storages backup pour référence
    const allBackupStorages = (storages || []).filter(s => 
      s.content?.includes('backup')
    )
    
    // Récupérer les nodes du cluster
    const nodes = await pveFetch<any[]>(conn, `/nodes`)

    // Récupérer l'usage des storages depuis le premier node online
    const firstOnlineNode = (nodes || []).find((n: any) => n.status === 'online')
    let storageStatus: any[] = []
    if (firstOnlineNode) {
      try {
        storageStatus = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(firstOnlineNode.node)}/storage`) || []
      } catch { /* ignore */ }
    }
    
    // Formater les jobs avec plus d'infos
    const formattedJobs = (jobs || []).map((job: any) => {
      // Parser la sélection des VMs
      let selectionMode = 'all'
      let vmids: string[] = []
      let excludedVmids: string[] = []
      
      if (job.all === 1 || job.all === true) {
        selectionMode = 'all'

        if (job.exclude) {
          excludedVmids = job.exclude.split(',').map((v: string) => v.trim())
        }
      } else if (job.vmid) {
        selectionMode = 'include'
        vmids = job.vmid.split(',').map((v: string) => v.trim())
      } else if (job.pool) {
        selectionMode = 'pool'
      }
      
      return {
        id: job.id,
        enabled: job.enabled === 1 || job.enabled === true,
        schedule: job.schedule || '00:00',
        storage: job.storage,
        node: job.node || null, // null = tous les nodes
        mode: job.mode || 'snapshot', // snapshot, suspend, stop
        compress: job.compress || 'zstd',
        mailnotification: job.mailnotification || 'always',
        mailto: job.mailto || '',
        comment: job.comment || '',

        // Sélection
        selectionMode,
        vmids,
        excludedVmids,
        pool: job.pool || null,

        // PBS Namespace (important pour organiser les backups sur PBS)
        // prune-backups peut être un objet ou une string selon la version PVE
        namespace: (() => {
          const pruneBackups = job['prune-backups']

          if (typeof pruneBackups === 'string') {
            const match = pruneBackups.match(/ns=([^\s,]+)/)

            if (match) return match[1]
          }

          
return job.namespace || ''
        })(),

        // Retention
        maxfiles: job.maxfiles,
        pruneBackups: job['prune-backups'] || null,

        // Protection
        protected: job.protected === 1,

        // Notifications — PVE values: 'auto', 'legacy-sendmail', 'notification-system'
        notificationMode: job['notification-mode'] || 'auto',
        notificationTarget: job['notification-target'] || '',

        // Repeat missed (PVE 8+)
        repeatMissed: job['repeat-missed'] === 1 || job['repeat-missed'] === true || job['repeat-missed'] === '1',

        // Note template
        notesTemplate: job['notes-template'] || '',

        // Fleecing (PVE 8+) - can be object {enabled:1,storage:"local"}, string "enabled=1,storage=local", or boolean
        fleecing: (() => {
          const f = job.fleecing
          if (!f) return false
          if (typeof f === 'object') return f.enabled === 1 || f.enabled === true
          if (typeof f === 'string') return f.includes('enabled=1')
          return f === 1 || f === true
        })(),
        fleecingStorage: (() => {
          const f = job.fleecing
          if (!f) return ''
          if (typeof f === 'object') return f.storage || ''
          if (typeof f === 'string') {
            const m = f.match(/storage=([^\s,]+)/)
            return m ? m[1] : ''
          }
          return ''
        })(),

        // Performance options
        bwlimit: job.bwlimit || null,
        ioWorkers: job['io-workers'] || null,
        zstd: job.zstd || null,

        // PBS change detection
        pbsChangeDetectionMode: job['pbs-change-detection-mode'] || 'default',

        // Next run (calculé depuis le schedule)
        nextRun: job['next-run'] || null,

        // Raw pour debug
        _raw: job
      }
    })

    return NextResponse.json({ 
      data: {
        jobs: formattedJobs,

        // Tous les storages qui supportent les backups
        storages: allBackupStorages.map(s => {
          const status = storageStatus.find((ss: any) => ss.storage === s.storage)
          return {
            id: s.storage,
            name: s.storage,
            type: s.type,
            content: s.content,
            enabled: s.enabled !== 0,
            shared: s.shared === 1,
            isPbs: s.type === 'pbs',
            total: status?.total || 0,
            used: status?.used || 0,
            avail: status?.avail || 0,
          }
        }),

        // Tous les storages qui supportent les backups
        allBackupStorages: allBackupStorages.map(s => ({
          id: s.storage,
          name: s.storage,
          type: s.type,
          content: s.content,
          enabled: s.enabled !== 0,
          shared: s.shared === 1,
          isPbs: s.type === 'pbs'
        })),
        nodes: (nodes || []).map((n: any) => ({
          node: n.node,
          status: n.status,
          online: n.status === 'online'
        }))
      }
    })
  } catch (e: any) {
    console.error("[backup-jobs] GET Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/connections/[id]/backup-jobs
 * 
 * Crée un nouveau backup job
 * Endpoint Proxmox: POST /cluster/backup
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const body = await req.json()

    if (!id) {
      return NextResponse.json({ error: "Missing connection ID" }, { status: 400 })
    }

    // RBAC check - permission de créer des backup jobs
    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_CREATE, "connection", id)

    if (denied) return denied

    const conn = await getConnectionById(id)
    
    // Construire les paramètres pour Proxmox
    const params = new URLSearchParams()
    
    // Storage obligatoire
    if (!body.storage) {
      return NextResponse.json({ error: "Storage is required" }, { status: 400 })
    }

    params.set('storage', body.storage)
    
    // Schedule
    if (body.schedule) {
      params.set('schedule', body.schedule)
    }
    
    // Node (optionnel - si null, backup sur tous les nodes)
    if (body.node) {
      params.set('node', body.node)
    }
    
    // Mode de sauvegarde
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

      if (body.excludedVmids && body.excludedVmids.length > 0) {
        params.set('exclude', body.excludedVmids.join(','))
      }
    } else if (body.selectionMode === 'include' && body.vmids?.length > 0) {
      params.set('vmid', body.vmids.join(','))
    } else if (body.selectionMode === 'pool' && body.pool) {
      params.set('pool', body.pool)
    }
    
    // Enabled
    params.set('enabled', body.enabled ? '1' : '0')
    
    // Commentaire
    if (body.comment) {
      params.set('comment', body.comment)
    }
    
    // Mail
    if (body.mailto) {
      params.set('mailto', body.mailto)
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

    // Advanced options
    if (body.bwlimit) params.set('bwlimit', body.bwlimit)
    if (body.zstd) params.set('zstd', body.zstd)
    if (body.ioWorkers) params.set('io-workers', body.ioWorkers)
    if (body.fleecing) {
      const fleeceParts = ['enabled=1']
      if (body.fleecingStorage) fleeceParts.push(`storage=${body.fleecingStorage}`)
      params.set('fleecing', fleeceParts.join(','))
    }
    if (body.repeatMissed) params.set('repeat-missed', '1')
    if (body.pbsChangeDetectionMode && body.pbsChangeDetectionMode !== 'default') {
      params.set('pbs-change-detection-mode', body.pbsChangeDetectionMode)
    }

    // PBS Namespace
    if (body.namespace) {
      const existingPrune = params.get('prune-backups') || ''
      if (existingPrune && !existingPrune.includes('ns=')) {
        params.set('prune-backups', `${existingPrune},ns=${body.namespace}`)
      } else if (!existingPrune) {
        params.set('prune-backups', `ns=${body.namespace}`)
      }
    }

    // Créer le job
    const result = await pveFetch<any>(conn, `/cluster/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })

    return NextResponse.json({ 
      data: result,
      message: 'Backup job created successfully'
    })
  } catch (e: any) {
    console.error("[backup-jobs] POST Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
