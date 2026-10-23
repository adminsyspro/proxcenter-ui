import { proxyHaJson } from '@/lib/orchestrator/haProxy'
import { haOperationWithBody } from '@/lib/orchestrator/haRoute'
import { PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // No license guard: HA config stays readable when the option expired
  // (spec v5 D2); the backend GET is equally ungated. Provider tenant only:
  // the control plane's HA is platform-wide (see haWriteGuard).
  const perm = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  return proxyHaJson('/ha/config')
}

export const PUT = withAudit({ category: 'system', resourceType: 'config' }, haOperationWithBody('/ha/config', 'PUT'))
