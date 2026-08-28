import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { assertVdcPbsAccess, getVdcScope } from "@/lib/vdc/scope"
import { getCurrentTenantId } from "@/lib/tenant"

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
export async function GET(req: Request, ctx: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const { id } = await ctx.params

    if (!id) {
      return NextResponse.json({ error: "Missing PBS connection ID" }, { status: 400 })
    }

    // RBAC check
    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_VIEW, "pbs", id)

    if (denied) return denied

    // Access verdict (union, same as GET /api/v1/pbs/[id]/backups): super
    // admins and MSP tenants owning this PBS outright get { kind: 'admin' }
    // (no namespace filtering); vDC (iaas) tenants get { kind: 'tenant',
    // allowed } carrying their authorised (datastore, namespace) pairs;
    // anyone else is rejected here.
    const access = await assertVdcPbsAccess(id)
    if (access instanceof Response) return access

    // This route is session-only (not on the public-API token allowlist —
    // only pbs/[id]/backups is), so there is no token principal to consider:
    // the DISPLAYED namespaces always follow the active vDC view context,
    // same pattern as the backups route's non-token branch.
    let allowedSet: Set<string> | null = null
    let allowedDatastores: Set<string> | null = null
    if (access.kind === 'tenant') {
      const tenantId = await getCurrentTenantId()
      const narrowed = await getVdcScope(tenantId)
      const unionKeys = new Set(access.allowed.map(p => `${p.datastore}|${p.namespace}`))
      const narrowedNs = narrowed?.pbsNamespacesByConnection.get(id) ?? []
      const narrowedKeys = new Set(narrowedNs.map(p => `${p.datastore}|${p.namespace}`))
      allowedSet = new Set([...unionKeys].filter(k => narrowedKeys.has(k)))
      allowedDatastores = new Set([...allowedSet].map(k => k.split('|')[0]))
    }
    // Deny-by-default: a job whose (datastore, namespace) pair isn't in the
    // caller's allowed set is excluded. admin/msp (allowedSet === null) see
    // everything, unchanged.
    const inScope = (datastore?: string, ns?: string): boolean =>
      !allowedSet || allowedSet.has(`${datastore ?? ''}|${ns ?? ''}`)

    const conn = access.kind === 'admin'
      ? await getPbsConnectionById(id)
      : await getPbsConnectionByIdUnscoped(id)

    // Récupérer les datastores d'abord (nécessaire pour les GC jobs).
    // For a scoped tenant, narrow to their authorised datastores up-front so
    // gc calls are never even made against a datastore they have no binding
    // on (and the returned `datastores` list never leaks names of datastores
    // outside their scope). Prune jobs come from the PBS-wide /admin/prune
    // and are narrowed by the (datastore, namespace) check further down.
    const datastores = await pbsFetch<any[]>(conn, "/admin/datastore").catch(() => [])
    let datastoreNames = (datastores || []).map(ds => ds.store || ds.name).filter(Boolean)
    if (allowedDatastores) {
      datastoreNames = datastoreNames.filter(store => allowedDatastores!.has(store))
    }

    // Récupérer tous les types de jobs en parallèle
    const [syncJobs, verifyJobs, rawPruneJobs] = await Promise.all([
      // Sync Jobs
      pbsFetch<any[]>(conn, "/admin/sync").catch(() => []),

      // Verify Jobs
      pbsFetch<any[]>(conn, "/admin/verify").catch(() => []),

      // Prune Jobs — endpoint global comme sync et verify, et non un appel par
      // datastore : /admin/datastore/{store}/prune-job n'existe pas cote PBS.
      pbsFetch<any[]>(conn, "/admin/prune").catch(() => []),
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

    // Le prune job porte son datastore dans `store` ; on l'expose sous
    // `datastore` comme le reste de la route.
    const pruneJobs = (rawPruneJobs || []).map(job => ({ ...job, datastore: job.store }))

    // Récupérer la GC config pour chaque datastore
    const gcConfigPromises = datastoreNames.map(async (store) => {
      try {
        const gcStatus = await pbsFetch<any>(conn, `/admin/datastore/${encodeURIComponent(store)}/gc`)

        
return { datastore: store, ...gcStatus }
      } catch {
        return null
      }
    })

    const gcConfigs = (await Promise.all(gcConfigPromises)).filter(Boolean)

    // Formater les Sync Jobs — /admin/sync is NOT datastore-scoped (returns
    // jobs across the whole PBS), so it needs an explicit (store, ns) check.
    const formattedSyncJobs = (syncJobs || []).filter((job: any) => inScope(job.store, job.ns || '')).map((job: any) => ({
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

    // Formater les Verify Jobs — /admin/verify is likewise PBS-wide, not
    // datastore-scoped.
    const formattedVerifyJobs = (verifyJobs || []).filter((job: any) => inScope(job.store, job.ns || '')).map((job: any) => ({
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

    // Formater les Prune Jobs — /admin/prune is PBS-wide, so the (datastore,
    // namespace) check is what narrows a scoped tenant here.
    const formattedPruneJobs = pruneJobs.filter((job: any) => inScope(job.datastore, job.ns || '')).map((job: any) => ({
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

    // Formater les GC configs (pas vraiment des "jobs" mais des configs de
    // garbage collection). GC operates at the whole-datastore level (no
    // namespace concept), already implicitly scoped since `gcConfigs` was
    // only computed from the narrowed `datastoreNames` above.
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

    // Formater les Tape Backup Jobs — PBS-wide endpoint, not datastore-scoped.
    const formattedTapeJobs = (tapeJobs || []).filter((job: any) => inScope(job.store, job.ns || '')).map((job: any) => ({
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
