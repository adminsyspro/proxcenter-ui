import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getSettingWithSource } from '@/lib/db/settings'
import { getCurrentTenantId } from '@/lib/tenant'
import { getAsset, slotFromFilename, type AssetKind } from '@/lib/branding/assetStore'

// Private keeps the bytes out of shared caches; the URL carries the reader's
// scope and the upload cache-buster, so an hour of browser caching is safe and
// spares the logo, favicon and login background a download on every page.
const HEADERS = { 'Cache-Control': 'private, max-age=3600', Vary: 'Cookie, Authorization' }

export interface UploadedAssetRouteOptions {
  /** Asset family in `uploaded_assets`. */
  kind: AssetKind
  /** Folder name under `data/uploads/` for the tenant-scoped disk fallback. */
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
    req: Request,
    { params }: { params: Promise<{ filename: string }> }
  ) {
    try {
      const { filename } = await params
      const sanitized = path.basename(filename)

      let tenantId = 'default'
      try { tenantId = await getCurrentTenantId() } catch {}

      const setting = kind === 'branding' ? await getSettingWithSource('branding', tenantId) : null
      const inheritedOwner = setting?.tenantId ?? tenantId
      const requestedOwner = new URL(req.url).searchParams.get('tenant')

      // An explicit owner supports upload previews before settings are saved.
      // It is never authority to read an unrelated tenant's assets.
      if (requestedOwner && requestedOwner !== tenantId && requestedOwner !== inheritedOwner) {
        return NextResponse.json({ error: 'Not found' }, { status: 404, headers: HEADERS })
      }
      const ownerTenantId = requestedOwner || inheritedOwner
      const slot = slotFromFilename(sanitized)
      // A tenant row carrying an upload URL without owning the bytes can only
      // come from saving the inherited provider branding (the form sends the
      // URLs back): the provider logo is what that tenant saw and kept. The
      // provider is the only fallback, never another tenant.
      const owners = kind === 'branding' && ownerTenantId !== 'default' ? [ownerTenantId, 'default'] : [ownerTenantId]
      for (const owner of owners) {
        const asset = await getAsset(owner, kind, slot)
        if (asset) {
          return new NextResponse(new Uint8Array(asset.data), {
            headers: { ...HEADERS, 'Content-Type': asset.contentType },
          })
        }
      }

      const baseDir = path.join(process.cwd(), 'data', 'uploads', dirName)
      // Unscoped legacy files have no trustworthy owner and must never be
      // used as another tenant's branding (including the public login page).
      const filePath = owners.map(owner => path.join(baseDir, owner, sanitized)).find(candidate => fs.existsSync(candidate))
      if (!filePath) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: HEADERS })

      const ext = sanitized.split('.').pop()?.toLowerCase() || ''
      const contentType = mimeTypes[ext] || 'application/octet-stream'
      const buffer = fs.readFileSync(filePath)
      return new NextResponse(new Uint8Array(buffer), {
        headers: { ...HEADERS, 'Content-Type': contentType },
      })
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: HEADERS })
    }
  }
}
