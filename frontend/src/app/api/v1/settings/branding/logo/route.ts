export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { putAsset, deleteAsset } from '@/lib/branding/assetStore'

const SERVE_PATH = '/api/v1/settings/branding/uploads'
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']
const SLOTS = ['logo', 'favicon', 'loginLogo']

export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const type = formData.get('type') as string // 'logo' | 'favicon' | 'loginLogo'

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!SLOTS.includes(type)) return NextResponse.json({ error: 'Invalid type. Must be logo, favicon, or loginLogo' }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })

    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const buffer = Buffer.from(await file.arrayBuffer())
    await putAsset(tenantId, 'branding', type, ext, file.type, buffer)

    const imageUrl = `${SERVE_PATH}/${type}.${ext}?t=${Date.now()}`
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
    const { type } = await req.json()
    if (!SLOTS.includes(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

    await deleteAsset(tenantId, 'branding', type)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
