import { proxyHaJson } from '@/lib/orchestrator/haProxy'
import { haOperationWithBody } from '@/lib/orchestrator/haRoute'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // No license guard: HA config stays readable when the option expired
  // (spec v5 D2); the backend GET is equally ungated.
  const perm = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  return proxyHaJson('/ha/config')
}

export const PUT = haOperationWithBody('/ha/config', 'PUT')
