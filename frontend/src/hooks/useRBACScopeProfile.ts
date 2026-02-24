import { useMemo } from 'react'

import { useRBAC } from '@/contexts/RBACContext'

import type { ViewMode } from '@/app/(dashboard)/infrastructure/inventory/InventoryTree'

/** Scope types that reveal infrastructure details (cluster/node names) */
const INFRA_SCOPES = new Set(['global', 'connection', 'node'])

/** View modes that are always safe — they only show VMs the user can access */
const ALWAYS_ALLOWED: ViewMode[] = ['vms', 'favorites', 'templates']

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

  return useMemo(() => {
    if (loading) {
      return {
        defaultViewMode: 'tree' as ViewMode,
        allowedViewModes: new Set<ViewMode>(['tree', 'vms', 'hosts', 'pools', 'tags', 'favorites', 'templates']),
        loading: true,
      }
    }

    // Admins get everything
    if (isAdmin) {
      return {
        defaultViewMode: 'tree' as ViewMode,
        allowedViewModes: new Set<ViewMode>(['tree', 'vms', 'hosts', 'pools', 'tags', 'favorites', 'templates']),
        loading: false,
      }
    }

    // Collect unique scope types from user's roles
    const scopeTypes = new Set<string>(
      roles.map((r: any) => r.scope_type).filter(Boolean)
    )

    // No roles at all → minimal view
    if (scopeTypes.size === 0) {
      return {
        defaultViewMode: 'vms' as ViewMode,
        allowedViewModes: new Set<ViewMode>(ALWAYS_ALLOWED),
        loading: false,
      }
    }

    const hasInfra = [...scopeTypes].some(s => INFRA_SCOPES.has(s))
    const hasTag = scopeTypes.has('tag')
    const hasPool = scopeTypes.has('pool')
    const hasVm = scopeTypes.has('vm')

    // Any infra scope → full access
    if (hasInfra) {
      return {
        defaultViewMode: 'tree' as ViewMode,
        allowedViewModes: new Set<ViewMode>(['tree', 'vms', 'hosts', 'pools', 'tags', 'favorites', 'templates']),
        loading: false,
      }
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

    return {
      defaultViewMode: defaultView,
      allowedViewModes: allowed,
      loading: false,
    }
  }, [roles, isAdmin, loading])
}
