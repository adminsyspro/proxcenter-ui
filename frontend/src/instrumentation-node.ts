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
import { resolveInstanceId, sweepOrphanedMigrationJobs } from '@/lib/migration/orphan-sweep'
import { startSFlowReconciler } from '@/lib/sflow/reconciler'

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
}
