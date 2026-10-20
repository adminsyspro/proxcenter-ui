// Node-only startup work, loaded from instrumentation.ts behind a positive
// NEXT_RUNTIME === 'nodejs' check so the Edge bundle tree-shakes it.
// Runs once when the server process starts (both `next start` and the
// standalone start.js), after the Docker entrypoint has applied migrations.
// Replaces the dead one-shot upload-import script (M8): legacy on-disk
// uploads are imported into uploaded_assets so all HA nodes serve identical
// branding, login backgrounds and compliance PDF logos.
import path from 'node:path'

import { Agent, setGlobalDispatcher } from 'undici'

import { startSessionSweeper } from '@/lib/auth/sessionSweeper'
import { importDiskAssets } from '@/lib/branding/importDiskAssets'
import { prisma } from '@/lib/db/prisma'
import { startBatchPump } from '@/lib/migration/batch-scheduler'
import { resolveInstanceId, sweepOrphanedMigrationJobs } from '@/lib/migration/orphan-sweep'
import { cleanupOrphanedWarmSources } from '@/lib/migration/warm/orphan-cleanup'
import { startSFlowReconciler } from '@/lib/sflow/reconciler'
import { startOrchestratorAuditRelay } from '@/lib/syslog/orchestratorRelay'
import { startCatalogRefresher } from '@/lib/templates/catalogRefresher'
import { isCatalogAutoUpdateEnabled } from '@/lib/templates/catalogStore'
import { startVdcUsageSampler } from '@/lib/vdc/usageHistory/sampler'

export async function registerNode(): Promise<void> {
  // undici 8 negotiates HTTP/2 through ALPN by default. Every hypervisor API we
  // call was only ever exercised over HTTP/1.1, so the process-wide dispatcher
  // behind every `request()` without an explicit one stays on h1; the explicit
  // Agents in lib/ pin `allowH2: false` themselves (see lib/http/insecure-fetch.ts).
  setGlobalDispatcher(new Agent({ allowH2: false }))

  if (process.env.DEMO_MODE === 'true') return

  try {
    const root = path.join(process.cwd(), 'data', 'uploads')
    const res = await importDiskAssets(root)
    if (res.imported > 0 || res.skipped > 0) {
      console.log(`[startup] disk-asset import: imported=${res.imported} skipped=${res.skipped}`)
    }
  } catch (err) {
    // Boot must never depend on this import: the assets are also served
    // from disk on node 1, and the next boot retries.
    console.error('[startup] disk-asset import failed (non-fatal):', err)
  }

  try {
    const swept = await sweepOrphanedMigrationJobs({ prisma, instanceId: resolveInstanceId() })
    if (swept.total > 0) {
      console.log(`[startup] orphaned migration jobs failed: owned=${swept.owned} foreign=${swept.foreign}`)
      // A warm run killed by the restart could not clean its source VM (warm
      // snapshot, CBT it enabled). Done in the background: it talks to vSphere
      // and boot must not wait on, or fail with, a source host.
      void cleanupOrphanedWarmSources(swept.jobIds).catch(err => console.error('[startup] warm source cleanup failed (non-fatal):', err))
    }
  } catch (err) {
    // Boot must never depend on the sweep: the rows stay non-terminal and the
    // next boot retries.
    console.error('[startup] orphaned migration sweep failed (non-fatal):', err)
  }

  try {
    // Bounds how long a dead session row's ipAddress/userAgent survives for a
    // user who never signs in again. Runs on every HA replica; no leader
    // election needed since the purge is an idempotent deleteMany.
    startSessionSweeper()
  } catch (err) {
    // Boot must never depend on this: the rows stay in place and the next
    // boot retries starting the sweeper.
    console.error('[startup] session sweeper failed to start (non-fatal):', err)
  }

  try {
    // OVS forgets its sFlow configuration when a node's bridges are recreated,
    // so a reboot silently stops the flow panels. Nothing used to notice.
    // Idempotent, so it runs on every replica without leader election.
    startSFlowReconciler()
  } catch (err) {
    // Boot must never depend on this: the nodes simply stay as they are and
    // the next boot retries starting the reconciler.
    console.error('[startup] sFlow reconciler failed to start (non-fatal):', err)
  }

  try {
    // vDC usage history (#902): measures every vDC at the cadence set in the
    // vDC settings, whether or not anybody opens a page. Every replica starts
    // it; a database lease lets exactly one of them sample.
    startVdcUsageSampler()
  } catch (err) {
    // Boot must never depend on this: the history simply misses the periods
    // until the next boot starts the sampler.
    console.error('[startup] vDC usage sampler failed to start (non-fatal):', err)
  }

  try {
    // Bulk migrations (roadmap#53): starts the queued jobs of every running
    // batch, so a batch carries on after this restart and without the
    // browser that launched it. Every replica starts it; a database lease
    // lets exactly one of them pump.
    startBatchPump()
  } catch (err) {
    // Boot must never depend on this: the batches stay queued and the next
    // job end, resume or boot pumps them.
    console.error('[startup] migration batch pump failed to start (non-fatal):', err)
  }

  try {
    // The built-in cloud image catalog is also published as JSON in the
    // public repo. One fetch a day keeps new distribution releases showing
    // up without a ProxCenter release. TEMPLATE_CATALOG_AUTO_UPDATE=false
    // (air-gapped sites) leaves only the manual button on the catalog tab.
    if (isCatalogAutoUpdateEnabled()) startCatalogRefresher()
  } catch (err) {
    // Boot must never depend on this: the embedded catalog keeps serving.
    console.error('[startup] catalog refresher failed to start (non-fatal):', err)
  }

  try {
    // Audit rows the Go orchestrator writes (DRS, rolling updates, drains,
    // replication, #1105) reach the syslog destinations through this relay.
    // Every replica starts it; a row lock on the cursor lets one forward.
    startOrchestratorAuditRelay()
  } catch (err) {
    // Boot must never depend on this: the rows stay in the database and the
    // next boot resumes from the cursor.
    console.error('[startup] orchestrator audit relay failed to start (non-fatal):', err)
  }
}
