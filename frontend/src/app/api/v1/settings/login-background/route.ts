export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { getAsset, putAsset, deleteAsset } from '@/lib/branding/assetStore'

const SERVE_PATH = '/api/v1/settings/login-background/serve'
const VALID_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export async function GET() {
  try {
    let tenantId = 'default'
    try { tenantId = await getCurrentTenantId() } catch {}
    const asset = await getAsset(tenantId, 'login-bg', 'background')
    if (!asset) return NextResponse.json({ imageUrl: null })
    return NextResponse.json({ imageUrl: `${SERVE_PATH}/background.${asset.ext}?t=${Date.now()}` })
  } catch { return NextResponse.json({ imageUrl: null }) }
}

export async function POST(request: Request) {
  try {
    const permError = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (permError) return permError

    const tenantId = await getCurrentTenantId()
    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!VALID_TYPES.includes(file.type)) return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'File too large' }, { status: 400 })

    const ext = file.type.split('/')[1].replaceAll('jpeg', 'jpg')
    const buffer = Buffer.from(await file.arrayBuffer())
    await putAsset(tenantId, 'login-bg', 'background', ext, file.type, buffer)

    return NextResponse.json({ success: true, imageUrl: `${SERVE_PATH}/background.${ext}?t=${Date.now()}` })
  } catch { return NextResponse.json({ error: 'Upload failed' }, { status: 500 }) }
}

export async function DELETE() {
  try {
    const permError = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (permError) return permError
    const tenantId = await getCurrentTenantId()
    await deleteAsset(tenantId, 'login-bg', 'background')
    return NextResponse.json({ success: true })
  } catch { return NextResponse.json({ error: 'Delete failed' }, { status: 500 }) }
}
