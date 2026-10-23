import { proxyHaJson } from '@/lib/orchestrator/haProxy'
import { PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // No license guard: cluster status stays readable when the option expired
  // (spec v5 D2); the backend GET is equally ungated. Provider tenant only:
  // the control plane's HA is platform-wide (see haWriteGuard).
  const perm = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  return proxyHaJson('/ha/cluster')
}
