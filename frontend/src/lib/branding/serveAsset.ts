import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getCurrentTenantId } from '@/lib/tenant'
import { getAsset, slotFromFilename, type AssetKind } from '@/lib/branding/assetStore'

const CACHE_CONTROL = 'public, max-age=3600'

export interface UploadedAssetRouteOptions {
  /** Asset family in `uploaded_assets`. */
  kind: AssetKind
  /** Folder name under `data/uploads/` and `public/uploads/` for the disk fallback. */
  dirName: string
  /** Extension to Content-Type map used by the disk fallback only. */
  mimeTypes: Record<string, string>
}

/**
 * Builds the GET handler that serves an uploaded asset.
 *
 * The database is the source of truth, so every node of an HA cluster returns
 * the same bytes. Files that predate the DB-backed store and were never
 * imported are still served from disk, which only ever happens on a
 * single-node install.
 *
 * The branding and login-background routes were byte-for-byte identical apart
 * from the three options above; they are generated from here so the pair
 * cannot drift.
 */
export function createUploadedAssetRoute(options: UploadedAssetRouteOptions) {
  const { kind, dirName, mimeTypes } = options

  return async function GET(
    _req: Request,
    { params }: { params: Promise<{ filename: string }> }
  ) {
    try {
      const { filename } = await params
      const sanitized = path.basename(filename)

      let tenantId = 'default'
      try { tenantId = await getCurrentTenantId() } catch {}

      const asset = await getAsset(tenantId, kind, slotFromFilename(sanitized))
      if (asset) {
        return new NextResponse(new Uint8Array(asset.data), {
          headers: { 'Content-Type': asset.contentType, 'Cache-Control': CACHE_CONTROL },
        })
      }

      const baseDir = path.join(process.cwd(), 'data', 'uploads', dirName)
      const legacyDir = path.join(process.cwd(), 'public', 'uploads', dirName)
      let filePath = path.join(baseDir, tenantId, sanitized)
      if (!fs.existsSync(filePath)) filePath = path.join(baseDir, sanitized)
      if (!fs.existsSync(filePath)) filePath = path.join(legacyDir, sanitized)
      if (!fs.existsSync(filePath)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const ext = sanitized.split('.').pop()?.toLowerCase() || ''
      const contentType = mimeTypes[ext] || 'application/octet-stream'
      const buffer = fs.readFileSync(filePath)
      return new NextResponse(new Uint8Array(buffer), {
        headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL },
      })
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }
}
