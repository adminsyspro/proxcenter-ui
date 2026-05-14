export const dynamic = "force-dynamic"
import path from 'path'
import fs from 'fs'

import { NextResponse } from 'next/server'

import { getCurrentTenantId } from '@/lib/tenant'

const BASE_UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'branding')
const LEGACY_DIR = path.join(process.cwd(), 'public', 'uploads', 'branding')

// `svg` is intentionally absent: legacy uploads on disk from before the
// SVG block was added still get served, but as application/octet-stream
// (the fallback) so the browser will not render them and execute any
// embedded <script>. New uploads can no longer create .svg files
// (see logo/route.ts EXT_FOR_MIME).
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
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

        // Prevent the browser from MIME-sniffing a legacy .svg back into
        // image/svg+xml and executing embedded scripts.
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
