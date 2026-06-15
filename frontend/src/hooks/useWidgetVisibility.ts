import { useMemo } from 'react'

import { useRBAC } from '@/contexts/RBACContext'
import { useTenant } from '@/contexts/TenantContext'

/** Scope types that reveal infrastructure topology (cluster/node names) */
const INFRA_SCOPES = new Set(['global', 'connection', 'node'])

export type WidgetVisibility = {
  hasInfraScope: boolean
  hiddenWidgets: Set<string>
  loading: boolean
}

/**
 * Derives which widgets a user is allowed to see based on their RBAC roles
 * and the active tenant. Combines two filters:
 *
 * 1. Automatic scope filter — admin or infra-scoped (global/connection/node)
 *    on the provider tenant → infra widgets allowed. Tag/VM/pool-only or
 *    non-provider tenants → infra widgets hidden.
 *
 * 2. Admin denylist — `widget_overrides.hidden` per role, unioned across all
 *    of the user's active roles via the effective RBAC endpoint. Lets an
 *    admin tailor a role's dashboard beyond the scope-based default. Super
 *    admins always carry an empty denylist (they see everything).
 */
export function useWidgetVisibility(): WidgetVisibility {
  const { scopeTypes, isAdmin, hiddenWidgets: hiddenWidgetIds, loading } = useRBAC()
  const { isFullClusterView, loading: tenantLoading } = useTenant()

  return useMemo(() => {
    const hiddenWidgets = new Set<string>(
      Array.isArray(hiddenWidgetIds) ? hiddenWidgetIds : [],
    )

    if (loading || tenantLoading) {
      return { hasInfraScope: true, hiddenWidgets, loading: true }
    }

    // IaaS/vDC tenants get the cloud-style abstraction: nodes / clusters are
    // an implementation detail, never surfaced regardless of RBAC scope.
    // Provider AND MSP tenants both have full-cluster visibility; MSP data is
    // already scoped to the tenant's own connections server-side.
    if (!isFullClusterView) {
      return { hasInfraScope: false, hiddenWidgets, loading: false }
    }

    if (isAdmin) return { hasInfraScope: true, hiddenWidgets, loading: false }

    // Use the aggregated scope_types from /rbac/effective which already unions
    // role scopes AND direct-permission scopes, so a user with a direct
    // global/connection/node grant (no role) is correctly detected as infra.
    const userScopes = Array.isArray(scopeTypes) ? scopeTypes : []
    const hasInfra = userScopes.some((s: string) => INFRA_SCOPES.has(s))

    return { hasInfraScope: hasInfra, hiddenWidgets, loading: false }
  }, [scopeTypes, isAdmin, hiddenWidgetIds, loading, isFullClusterView, tenantLoading])
}
