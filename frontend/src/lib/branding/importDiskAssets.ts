// Startup importer: seeds pre-existing on-disk assets (data/uploads/branding,
// data/uploads/login-bg; the compliance PDF logo is a 'branding' asset) into
// Postgres so every HA node serves them. Runs at every server boot via
// src/instrumentation.ts, AFTER migrations (the Docker entrypoint applies
// them before the server starts). Insert-only: an asset already present in
// uploaded_assets is never overwritten by a stale disk file.

import fs from 'fs'
import path from 'path'

import { getAsset, putAsset, slotFromFilename, type AssetKind } from './assetStore'

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
  gif: 'image/gif',
}

const KIND_DIRS: Array<{ dir: string; kind: AssetKind }> = [
  { dir: 'branding', kind: 'branding' },
  { dir: 'login-bg', kind: 'login-bg' },
]

export async function importDiskAssets(rootDir: string): Promise<{ imported: number; skipped: number }> {
  let imported = 0
  let skipped = 0
  if (!fs.existsSync(rootDir)) return { imported, skipped }

  for (const { dir, kind } of KIND_DIRS) {
    const kindDir = path.join(rootDir, dir)
    if (!fs.existsSync(kindDir)) continue
    for (const entry of fs.readdirSync(kindDir)) {
      const entryPath = path.join(kindDir, entry)
      // A file directly under the kind directory predates multi-tenancy, when
      // the provider was the only uploader: it is the provider's. Insert-only
      // still applies, so a logo uploaded since through the UI always wins.
      const files = fs.statSync(entryPath).isDirectory()
        ? fs.readdirSync(entryPath).map(file => ({ tenantId: entry, file, filePath: path.join(entryPath, file) }))
        : [{ tenantId: 'default', file: entry, filePath: entryPath }]
      for (const { tenantId, file, filePath } of files) {
        const ext = (file.split('.').pop() || '').toLowerCase()
        const contentType = MIME_BY_EXT[ext]
        if (!contentType) { skipped++; continue }
        const slot = slotFromFilename(file)
        const existing = await getAsset(tenantId, kind, slot)
        if (existing) { skipped++; continue }
        const data = fs.readFileSync(filePath)
        await putAsset(tenantId, kind, slot, ext, contentType, data)
        imported++
      }
    }
  }
  return { imported, skipped }
}
