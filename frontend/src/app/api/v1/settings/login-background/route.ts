import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { writeFile, mkdir, unlink, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { authOptions } from '@/lib/auth/config'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'login-bg')
const PUBLIC_PATH = '/uploads/login-bg'

export async function GET() {
  try {
    if (!existsSync(UPLOAD_DIR)) return NextResponse.json({ imageUrl: null })
    const files = await readdir(UPLOAD_DIR)
    const imageFile = files.find(f => f.startsWith('background.'))
    if (!imageFile) return NextResponse.json({ imageUrl: null })
    return NextResponse.json({ imageUrl: `${PUBLIC_PATH}/${imageFile}?t=${Date.now()}` })
  } catch { return NextResponse.json({ imageUrl: null }) }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userRole = (session.user as any).role
    if (userRole !== 'admin' && userRole !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!validTypes.includes(file.type)) return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'File too large' }, { status: 400 })

    if (!existsSync(UPLOAD_DIR)) await mkdir(UPLOAD_DIR, { recursive: true })

    const existingFiles = await readdir(UPLOAD_DIR)
    for (const f of existingFiles) {
      if (f.startsWith('background.')) await unlink(path.join(UPLOAD_DIR, f))
    }

    const ext = file.type.split('/')[1].replace('jpeg', 'jpg')
    const filename = `background.${ext}`
    const bytes = await file.arrayBuffer()
    await writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(bytes))

    return NextResponse.json({ success: true, imageUrl: `${PUBLIC_PATH}/${filename}?t=${Date.now()}` })
  } catch { return NextResponse.json({ error: 'Upload failed' }, { status: 500 }) }
}

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userRole = (session.user as any).role
    if (userRole !== 'admin' && userRole !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (existsSync(UPLOAD_DIR)) {
      const files = await readdir(UPLOAD_DIR)
      for (const f of files) {
        if (f.startsWith('background.')) await unlink(path.join(UPLOAD_DIR, f))
      }
    }
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Delete failed' }, { status: 500 }) }
}
