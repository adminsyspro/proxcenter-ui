export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import { getCurrentTenantId } from '@/lib/tenant'

const BASE_UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'login-bg')
const LEGACY_DIR = path.join(process.cwd(), 'public', 'uploads', 'login-bg')

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params
    const sanitized = path.basename(filename)

    // Resolve tenant (fallback to default for unauthenticated login page)
    let tenantId = 'default'
    try { tenantId = await getCurrentTenantId() } catch {}

    // Try tenant-specific directory first
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
