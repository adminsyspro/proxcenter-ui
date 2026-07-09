export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getCurrentTenantId } from '@/lib/tenant'
import { getAsset, slotFromFilename } from '@/lib/branding/assetStore'

const BASE_UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'branding')
const LEGACY_DIR = path.join(process.cwd(), 'public', 'uploads', 'branding')

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params
    const sanitized = path.basename(filename)

    let tenantId = 'default'
    try { tenantId = await getCurrentTenantId() } catch {}

    // DB first: the HA source of truth.
    const asset = await getAsset(tenantId, 'branding', slotFromFilename(sanitized))
    if (asset) {
      return new NextResponse(new Uint8Array(asset.data), {
        headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'public, max-age=3600' },
      })
    }

    // Disk fallback for pre-existing files not yet imported (single-node only).
    let filePath = path.join(BASE_UPLOAD_DIR, tenantId, sanitized)
    if (!fs.existsSync(filePath)) filePath = path.join(BASE_UPLOAD_DIR, sanitized)
    if (!fs.existsSync(filePath)) filePath = path.join(LEGACY_DIR, sanitized)
    if (!fs.existsSync(filePath)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const ext = sanitized.split('.').pop()?.toLowerCase() || ''
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    const buffer = fs.readFileSync(filePath)
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
