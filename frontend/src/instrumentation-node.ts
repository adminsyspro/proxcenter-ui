// Node-only startup work, loaded from instrumentation.ts behind a positive
// NEXT_RUNTIME === 'nodejs' check so the Edge bundle tree-shakes it.
// Runs once when the server process starts (both `next start` and the
// standalone start.js), after the Docker entrypoint has applied migrations.
// Replaces the dead one-shot upload-import script (M8): legacy on-disk
// uploads are imported into uploaded_assets so all HA nodes serve identical
// branding, login backgrounds and compliance PDF logos.
import path from 'node:path'

import { importDiskAssets } from '@/lib/branding/importDiskAssets'

export async function registerNode(): Promise<void> {
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
}
