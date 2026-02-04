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

        // Notifications
        notificationMode: job['notification-mode'] || 'auto',
        notificationTarget: job['notification-target'] || '',

        // Repeat missed (PVE 8+)
        repeatMissed: job['repeat-missed'] === 1 || job['repeat-missed'] === true,

        // Fleecing (PVE 8+)
        fleecing: job.fleecing || null,

        // Performance options
        bwlimit: job.bwlimit || null,
        ionice: job.ionice || null,
        lockwait: job.lockwait || null,
        pigz: job.pigz || null,
        zstd: job.zstd || null,

        // Next run (calculé depuis le schedule)
        nextRun: job['next-run'] || null,

        // Raw pour debug
        _raw: job
      }
    })

    return NextResponse.json({ 
      data: {
        jobs: formattedJobs,

        // Storages PBS uniquement (pour les backups avec namespace)
        storages: backupStorages.map(s => ({
          id: s.storage,
          name: s.storage,
          type: s.type,
          content: s.content,
          enabled: s.enabled !== 0,
          shared: s.shared === 1,
          isPbs: s.type === 'pbs'
        })),

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
    
    // Retention
    if (body.maxfiles !== undefined) {
      params.set('maxfiles', String(body.maxfiles))
    }

    if (body.pruneBackups) {
      params.set('prune-backups', body.pruneBackups)
    }

    // PBS Namespace (pour organiser les backups sur PBS)
    // Note: Le namespace est passé dans prune-backups ou via notes-template selon la version PVE
    if (body.namespace) {
      // Pour PVE 8.x, le namespace PBS peut être inclus dans les options de prune
      // ou directement via le storage qui le supporte
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
