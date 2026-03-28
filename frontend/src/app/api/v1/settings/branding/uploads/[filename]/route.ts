export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getCurrentTenantId } from '@/lib/tenant'

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

    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(filename)

    // Try tenant-specific directory first
    let tenantId = 'default'
    try { tenantId = await getCurrentTenantId() } catch {}

    let filePath = path.join(BASE_UPLOAD_DIR, tenantId, sanitized)
    // Fallback to non-tenant directory (pre-migration files)
    if (!fs.existsSync(filePath)) {
      filePath = path.join(BASE_UPLOAD_DIR, sanitized)
    }
    // Then legacy public/ location
    if (!fs.existsSync(filePath)) {
      filePath = path.join(LEGACY_DIR, sanitized)
    }
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const ext = sanitized.split('.').pop()?.toLowerCase() || ''
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    const buffer = fs.readFileSync(filePath)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
