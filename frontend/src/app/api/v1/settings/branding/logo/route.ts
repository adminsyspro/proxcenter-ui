import { NextResponse } from 'next/server'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import path from 'path'
import fs from 'fs'

const BASE_UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'branding')
const SERVE_PATH = '/api/v1/settings/branding/uploads'
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']

function getUploadDir(tenantId: string) {
  return path.join(BASE_UPLOAD_DIR, tenantId)
}

export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const uploadDir = getUploadDir(tenantId)

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const type = formData.get('type') as string // 'logo', 'favicon', 'loginLogo'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!['logo', 'favicon', 'loginLogo'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type. Must be logo, favicon, or loginLogo' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
    }

    // Ensure tenant-specific upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }

    // Remove old files for this type
    const existing = fs.readdirSync(uploadDir).filter(f => f.startsWith(`${type}.`))
    existing.forEach(f => fs.unlinkSync(path.join(uploadDir, f)))

    // Save new file
    const ext = file.name.split('.').pop() || 'png'
    const fileName = `${type}.${ext}`
    const filePath = path.join(uploadDir, fileName)
    const buffer = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(filePath, buffer)

    const imageUrl = `${SERVE_PATH}/${fileName}?t=${Date.now()}`

    return NextResponse.json({ success: true, imageUrl })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const uploadDir = getUploadDir(tenantId)

    const { type } = await req.json()

    if (!['logo', 'favicon', 'loginLogo'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (fs.existsSync(uploadDir)) {
      const existing = fs.readdirSync(uploadDir).filter(f => f.startsWith(`${type}.`))
      existing.forEach(f => fs.unlinkSync(path.join(uploadDir, f)))
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
