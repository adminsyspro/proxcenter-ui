import { useMemo } from 'react'

import { useRBAC } from '@/contexts/RBACContext'
import { useTenant } from '@/contexts/TenantContext'
import { INFRA_SCOPE_TYPES } from '@/lib/rbac/scopeKinds'

import type { ViewMode } from '@/app/(dashboard)/infrastructure/inventory/InventoryTree'

/** Scope types that reveal infrastructure details (cluster/node names).
 *  Shared with the nav/topology gate via INFRA_SCOPE_TYPES so "what counts as
 *  infra scope" has a single source of truth. */
const INFRA_SCOPES = new Set<string>(INFRA_SCOPE_TYPES)

/** View modes that are always safe — they only show VMs the user can access */
const ALWAYS_ALLOWED: ViewMode[] = ['vms', 'favorites', 'templates']

/** View modes that reveal cluster/node topology to the tenant — hidden when
 *  the session is on a non-provider tenant (cloud-style abstraction). */
const INFRA_VIEW_MODES = new Set<ViewMode>(['tree', 'hosts'])

type ScopeProfile = {
  /** Which view to open by default */
  defaultViewMode: ViewMode
  /** Which toggle buttons to show */
  allowedViewModes: Set<ViewMode>
  /** True while RBAC data is still loading */
  loading: boolean
}

/**
 * Analyzes the user's RBAC roles to determine which inventory view modes
 * are appropriate, and which one should be the default.
 *
 * - Admin or infra-scoped → all views, default "tree"
 * - Tag-only → tags, vms, favorites, templates — default "tags"
 * - Pool-only → pools, vms, favorites, templates — default "pools"
 * - Tag + pool → tags, pools, vms, favorites, templates — default "tags"
 * - VM-only → vms, favorites, templates — default "vms"
 * - Mixed infra + non-infra → all views, default "tree"
 * - No roles → vms, favorites, templates — default "vms"
 */
export function useRBACScopeProfile(): ScopeProfile {
  const { roles, isAdmin, loading } = useRBAC()
  const { currentTenant, loading: tenantLoading } = useTenant()
  // Tenants other than the provider get the cloud-style abstraction:
  // nodes / hosts / clusters are an implementation detail and never appear
  // in their UI, regardless of RBAC scope.
  const isProviderTenant = !tenantLoading && currentTenant?.id === 'default'
  // MSP-mode tenants own whole clusters, so they keep the infra views
  // (tree / hosts) like the provider. Only vDC / IaaS tenants get the
  // cloud-style abstraction that hides node/cluster topology.
  const isMspTenant = !tenantLoading && currentTenant?.operatingModel === 'msp'
  const hideInfra = !tenantLoading && !!currentTenant && !isProviderTenant && !isMspTenant

  return useMemo(() => {
    const restrict = (profile: ScopeProfile): ScopeProfile => {
      if (!hideInfra) return profile
      const safe = new Set<ViewMode>(
        [...profile.allowedViewModes].filter(m => !INFRA_VIEW_MODES.has(m)),
      )
      const defaultView = INFRA_VIEW_MODES.has(profile.defaultViewMode)
        ? ('vms' as ViewMode)
        : profile.defaultViewMode
      return { ...profile, allowedViewModes: safe, defaultViewMode: defaultView }
    }

    if (loading) {
      return restrict({
        defaultViewMode: 'tree' as ViewMode,
        allowedViewModes: new Set<ViewMode>(['tree', 'vms', 'hosts', 'pools', 'tags', 'favorites', 'templates']),
        loading: true,
      })
    }

    // Admins get everything
    if (isAdmin) {
      return restrict({
        defaultViewMode: 'tree' as ViewMode,
        allowedViewModes: new Set<ViewMode>(['tree', 'vms', 'hosts', 'pools', 'tags', 'favorites', 'templates']),
        loading: false,
      })
    }

    // Collect unique scope types from user's roles
    const scopeTypes = new Set<string>(
      roles.map((r: any) => r.scope_type).filter(Boolean)
    )

    // No roles at all → minimal view
    if (scopeTypes.size === 0) {
      return restrict({
        defaultViewMode: 'vms' as ViewMode,
        allowedViewModes: new Set<ViewMode>(ALWAYS_ALLOWED),
        loading: false,
      })
    }

    const hasInfra = [...scopeTypes].some(s => INFRA_SCOPES.has(s))
    const hasTag = scopeTypes.has('tag')
    const hasPool = scopeTypes.has('pool')
    const hasVm = scopeTypes.has('vm')

    // Any infra scope → full access
    if (hasInfra) {
      return restrict({
        defaultViewMode: 'tree' as ViewMode,
        allowedViewModes: new Set<ViewMode>(['tree', 'vms', 'hosts', 'pools', 'tags', 'favorites', 'templates']),
        loading: false,
      })
    }

    // Non-infra only
    const allowed = new Set<ViewMode>(ALWAYS_ALLOWED)
    let defaultView: ViewMode = 'vms'

    if (hasTag) {
      allowed.add('tags')
      defaultView = 'tags'
    }

    if (hasPool) {
      allowed.add('pools')
      if (!hasTag) defaultView = 'pools'
    }

    return restrict({
      defaultViewMode: defaultView,
      allowedViewModes: allowed,
      loading: false,
    })
  }, [roles, isAdmin, loading, hideInfra])
}
