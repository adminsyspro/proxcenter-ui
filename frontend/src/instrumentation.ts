// Next.js instrumentation hook: runs once when the server process starts
// (both `next start` and the standalone start.js), after the Docker
// entrypoint has applied migrations. Replaces the dead one-shot upload-import
// script (M8): legacy on-disk uploads are imported into uploaded_assets so
// all HA nodes serve identical branding, login backgrounds and compliance
// PDF logos.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.DEMO_MODE === 'true') return

  try {
    const path = await import('node:path')
    const { importDiskAssets } = await import('@/lib/branding/importDiskAssets')
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
