import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/v1/pbs/[id]/jobs
 * 
 * Récupère tous les jobs configurés sur le PBS :
 * - Sync Jobs (synchronisation entre PBS)
 * - Verify Jobs (vérification d'intégrité)
 * - Prune Jobs (nettoyage par datastore)
 * - GC Jobs (garbage collection)
 * - Tape Backup Jobs (si tape library configurée)
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params

    if (!id) {
      return NextResponse.json({ error: "Missing PBS connection ID" }, { status: 400 })
    }

    // RBAC check
    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_VIEW, "pbs", id)

    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    // Récupérer les datastores d'abord (nécessaire pour prune et GC jobs)
    const datastores = await pbsFetch<any[]>(conn, "/admin/datastore").catch(() => [])
    const datastoreNames = (datastores || []).map(ds => ds.store || ds.name).filter(Boolean)

    // Récupérer tous les types de jobs en parallèle
    const [syncJobs, verifyJobs] = await Promise.all([
      // Sync Jobs
      pbsFetch<any[]>(conn, "/admin/sync").catch(() => []),

      // Verify Jobs
      pbsFetch<any[]>(conn, "/admin/verify").catch(() => []),
    ])

    // Tape Backup Jobs - essayer plusieurs endpoints selon la version PBS
    let tapeJobs: any[] = []

    const tapeEndpoints = [
      '/config/tape-backup-job',  // PBS 2.x/3.x config endpoint - CORRECT
      '/tape/backup',             // Fallback
    ]
    
    for (const endpoint of tapeEndpoints) {
      try {
        const result = await pbsFetch<any[]>(conn, endpoint)

        if (result && Array.isArray(result)) {
          tapeJobs = result
          break
        }
      } catch {
        // Tape endpoint not available, try next
      }
    }

    // Récupérer les prune jobs et GC config pour chaque datastore
    const pruneJobsPromises = datastoreNames.map(async (store) => {
      try {
        const pruneJobs = await pbsFetch<any[]>(conn, `/admin/datastore/${encodeURIComponent(store)}/prune-job`)

        
return (pruneJobs || []).map(job => ({ ...job, datastore: store }))
      } catch {
        return []
      }
    })

    const gcConfigPromises = datastoreNames.map(async (store) => {
      try {
        const gcStatus = await pbsFetch<any>(conn, `/admin/datastore/${encodeURIComponent(store)}/gc`)

        
return { datastore: store, ...gcStatus }
      } catch {
        return null
      }
    })

    const pruneJobsArrays = await Promise.all(pruneJobsPromises)
    const gcConfigs = (await Promise.all(gcConfigPromises)).filter(Boolean)

    // Flatten prune jobs
    const pruneJobs = pruneJobsArrays.flat()

    // Formater les Sync Jobs
    const formattedSyncJobs = (syncJobs || []).map((job: any) => ({
      id: job.id,
      type: 'sync',
      enabled: job.disable !== true && job.disable !== 1,
      schedule: job.schedule || null,
      comment: job.comment || '',

      // Sync specific
      store: job.store,
      ns: job.ns || '', // Namespace source
      remote: job.remote,
      remoteStore: job['remote-store'],
      remoteNs: job['remote-ns'] || '', // Namespace distant
      owner: job.owner || '',
      removeVanished: job['remove-vanished'] === true || job['remove-vanished'] === 1,
      maxDepth: job['max-depth'],
      groupFilter: job['group-filter'] || [],
      rateLimit: job['rate-limit'],

      // Timestamps
      lastRunUpid: job['last-run-upid'] || null,
      lastRunState: job['last-run-state'] || null,
      lastRunEndtime: job['last-run-endtime'] ? new Date(job['last-run-endtime'] * 1000).toISOString() : null,
      nextRun: job['next-run'] ? new Date(job['next-run'] * 1000).toISOString() : null,
      _raw: job
    }))

    // Formater les Verify Jobs
    const formattedVerifyJobs = (verifyJobs || []).map((job: any) => ({
      id: job.id,
      type: 'verify',
      enabled: job.disable !== true && job.disable !== 1,
      schedule: job.schedule || null,
      comment: job.comment || '',

      // Verify specific
      store: job.store,
      ns: job.ns || '', // Namespace
      ignoreVerified: job['ignore-verified'] === true || job['ignore-verified'] === 1,
      outdatedAfter: job['outdated-after'], // Days
      maxDepth: job['max-depth'],
      groupFilter: job['group-filter'] || [],

      // Timestamps
      lastRunUpid: job['last-run-upid'] || null,
      lastRunState: job['last-run-state'] || null,
      lastRunEndtime: job['last-run-endtime'] ? new Date(job['last-run-endtime'] * 1000).toISOString() : null,
      nextRun: job['next-run'] ? new Date(job['next-run'] * 1000).toISOString() : null,
      _raw: job
    }))

    // Formater les Prune Jobs
    const formattedPruneJobs = pruneJobs.map((job: any) => ({
      id: job.id,
      type: 'prune',
      enabled: job.disable !== true && job.disable !== 1,
      schedule: job.schedule || null,
      comment: job.comment || '',

      // Prune specific
      datastore: job.datastore,
      ns: job.ns || '', // Namespace
      maxDepth: job['max-depth'],

      // Retention policy
      keepLast: job['keep-last'],
      keepHourly: job['keep-hourly'],
      keepDaily: job['keep-daily'],
      keepWeekly: job['keep-weekly'],
      keepMonthly: job['keep-monthly'],
      keepYearly: job['keep-yearly'],

      // Timestamps
      lastRunUpid: job['last-run-upid'] || null,
      lastRunState: job['last-run-state'] || null,
      lastRunEndtime: job['last-run-endtime'] ? new Date(job['last-run-endtime'] * 1000).toISOString() : null,
      nextRun: job['next-run'] ? new Date(job['next-run'] * 1000).toISOString() : null,
      _raw: job
    }))

    // Formater les GC configs (pas vraiment des "jobs" mais des configs de garbage collection)
    const formattedGcConfigs = gcConfigs.map((gc: any) => ({
      id: `gc-${gc.datastore}`,
      type: 'gc',
      datastore: gc.datastore,
      schedule: gc.schedule || null,

      // GC status
      upid: gc.upid || null,
      status: gc.status || null,

      // Dernière exécution
      lastRunUpid: gc['last-run-upid'] || gc.upid || null,
      lastRunState: gc['last-run-state'] || null,
      lastRunEndtime: gc['last-run-endtime'] ? new Date(gc['last-run-endtime'] * 1000).toISOString() : null,
      nextRun: gc['next-run'] ? new Date(gc['next-run'] * 1000).toISOString() : null,
      _raw: gc
    }))

    // Formater les Tape Backup Jobs
    const formattedTapeJobs = (tapeJobs || []).map((job: any) => ({
      id: job.id,
      type: 'tape',
      enabled: job.disable !== true && job.disable !== 1,
      schedule: job.schedule || null,
      comment: job.comment || '',

      // Tape specific
      store: job.store,
      ns: job.ns || '', // Namespace
      pool: job.pool, // Media pool
      drive: job.drive,
      ejectMedia: job['eject-media'] === true || job['eject-media'] === 1,
      exportMediaSet: job['export-media-set'] === true || job['export-media-set'] === 1,
      latestOnly: job['latest-only'] === true || job['latest-only'] === 1,
      notifyUser: job['notify-user'],
      maxDepth: job['max-depth'],
      groupFilter: job['group-filter'] || [],

      // Timestamps
      lastRunUpid: job['last-run-upid'] || null,
      lastRunState: job['last-run-state'] || null,
      lastRunEndtime: job['last-run-endtime'] ? new Date(job['last-run-endtime'] * 1000).toISOString() : null,
      nextRun: job['next-run'] ? new Date(job['next-run'] * 1000).toISOString() : null,
      _raw: job
    }))

    // Calculer les statistiques
    const allJobs = [
      ...formattedSyncJobs,
      ...formattedVerifyJobs,
      ...formattedPruneJobs,
      ...formattedGcConfigs,
      ...formattedTapeJobs
    ]

    const stats = {
      total: allJobs.length,
      enabled: allJobs.filter(j => !('enabled' in j) || j.enabled !== false).length,
      disabled: allJobs.filter(j => 'enabled' in j && j.enabled === false).length,
      byType: {
        sync: formattedSyncJobs.length,
        verify: formattedVerifyJobs.length,
        prune: formattedPruneJobs.length,
        gc: formattedGcConfigs.length,
        tape: formattedTapeJobs.length
      },
      lastRunStates: {
        ok: allJobs.filter(j => j.lastRunState === 'ok' || j.lastRunState === 'OK').length,
        error: allJobs.filter(j => j.lastRunState === 'error' || j.lastRunState === 'ERROR').length,
        warning: allJobs.filter(j => j.lastRunState === 'warning' || j.lastRunState === 'WARNING').length,
        unknown: allJobs.filter(j => !j.lastRunState).length
      }
    }

    return NextResponse.json({
      data: {
        jobs: {
          sync: formattedSyncJobs,
          verify: formattedVerifyJobs,
          prune: formattedPruneJobs,
          gc: formattedGcConfigs,
          tape: formattedTapeJobs,
          all: allJobs
        },
        datastores: datastoreNames,
        stats
      }
    })
  } catch (e: any) {
    console.error("[pbs-jobs] GET Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
