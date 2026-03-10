import { NextResponse } from 'next/server'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import path from 'path'
import fs from 'fs'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'branding')
const PUBLIC_PATH = '/uploads/branding'
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']

export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied


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

    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true })
    }

    // Remove old files for this type
    const existing = fs.readdirSync(UPLOAD_DIR).filter(f => f.startsWith(`${type}.`))
    existing.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f)))

    // Save new file
    const ext = file.name.split('.').pop() || 'png'
    const fileName = `${type}.${ext}`
    const filePath = path.join(UPLOAD_DIR, fileName)
    const buffer = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(filePath, buffer)

    const imageUrl = `${PUBLIC_PATH}/${fileName}?t=${Date.now()}`

    return NextResponse.json({ success: true, imageUrl })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied


    const { type } = await req.json()

    if (!['logo', 'favicon', 'loginLogo'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (fs.existsSync(UPLOAD_DIR)) {
      const existing = fs.readdirSync(UPLOAD_DIR).filter(f => f.startsWith(`${type}.`))
      existing.forEach(f => fs.unlinkSync(path.join(UPLOAD_DIR, f)))
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
