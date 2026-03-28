export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { writeFile, mkdir, unlink, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'

const BASE_UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'login-bg')
const SERVE_PATH = '/api/v1/settings/login-background/serve'

function getUploadDir(tenantId: string) {
  return path.join(BASE_UPLOAD_DIR, tenantId)
}

export async function GET() {
  try {
    let tenantId = 'default'
    try { tenantId = await getCurrentTenantId() } catch {}
    const uploadDir = getUploadDir(tenantId)

    if (!existsSync(uploadDir)) return NextResponse.json({ imageUrl: null })
    const files = await readdir(uploadDir)
    const imageFile = files.find(f => f.startsWith('background.'))
    if (!imageFile) return NextResponse.json({ imageUrl: null })

    // Serve via API route to avoid public/ directory issues
    return NextResponse.json({ imageUrl: `${SERVE_PATH}/${imageFile}?t=${Date.now()}` })
  } catch { return NextResponse.json({ imageUrl: null }) }
}

export async function POST(request: Request) {
  try {
    const permError = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (permError) return permError

    const tenantId = await getCurrentTenantId()
    const uploadDir = getUploadDir(tenantId)

    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!validTypes.includes(file.type)) return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'File too large' }, { status: 400 })

    if (!existsSync(uploadDir)) await mkdir(uploadDir, { recursive: true })

    const existingFiles = await readdir(uploadDir)
    for (const f of existingFiles) {
      if (f.startsWith('background.')) await unlink(path.join(uploadDir, f))
    }

    const ext = file.type.split('/')[1].replaceAll('jpeg', 'jpg')
    const filename = `background.${ext}`
    const bytes = await file.arrayBuffer()
    await writeFile(path.join(uploadDir, filename), Buffer.from(bytes))

    return NextResponse.json({ success: true, imageUrl: `${SERVE_PATH}/${filename}?t=${Date.now()}` })
  } catch { return NextResponse.json({ error: 'Upload failed' }, { status: 500 }) }
}

export async function DELETE() {
  try {
    const permError = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (permError) return permError

    const tenantId = await getCurrentTenantId()
    const uploadDir = getUploadDir(tenantId)

    if (existsSync(uploadDir)) {
      const files = await readdir(uploadDir)
      for (const f of files) {
        if (f.startsWith('background.')) await unlink(path.join(uploadDir, f))
      }
    }
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Delete failed' }, { status: 500 }) }
}
