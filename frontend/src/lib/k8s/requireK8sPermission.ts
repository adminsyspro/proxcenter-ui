import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { getServerLicense } from '@/lib/auth/requireEnterprise'
import { checkPermission, isUserSuperAdmin } from '@/lib/rbac'

export async function requireK8sPermission(permission: string): Promise<Response | null> {
  const lic = await getServerLicense()
  if (lic.enterprise) {
    return checkPermission(permission, 'global')
  }
  const session: any = await getServerSession(authOptions)
  const userId: string | undefined = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const superAdmin = await isUserSuperAdmin(userId)
  if (superAdmin) return null
  return NextResponse.json({ error: 'forbidden' }, { status: 403 })
}
