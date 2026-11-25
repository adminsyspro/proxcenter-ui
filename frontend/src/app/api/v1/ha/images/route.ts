import { proxyHaJson } from '@/lib/orchestrator/haProxy'
import { PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // Read-only, like GET /ha/cluster: no license guard (a lapsed option must
  // not hide outdated images from the operator of a running cluster), and
  // provider tenant only (see haWriteGuard).
  const perm = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  return proxyHaJson('/ha/images')
}
