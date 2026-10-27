'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

import { useSession } from 'next-auth/react'

import { hasGrantOn } from '@/lib/rbac/clientScope'
import type { ClientResourceType, GrantDetail } from '@/lib/rbac/clientScope'

/**
 * Contexte RBAC pour gérer les permissions de l'utilisateur connecté
 */

/** A role assignment as /api/v1/rbac/effective returns it. */
export interface EffectiveRole {
  id: string
  name: string
  color: string | null
  scope_type: string
  scope_target?: string | null
  resolved_scopes?: { scopeType: string; scopeTarget: string | null }[]
}

/** The `data` payload of /api/v1/rbac/effective. */
interface EffectiveRbac {
  permissions?: string[]
  permission_details?: GrantDetail[]
  roles?: EffectiveRole[]
  is_super_admin?: boolean
  scope_types?: string[]
  hidden_widgets?: string[]
}

export interface RBACContextValue {
  permissions: string[]
  roles: EffectiveRole[]
  isAdmin: boolean
  scopeTypes: string[]
  hiddenWidgets: string[]
  loading: boolean
  hasPermission: (permission: string) => boolean
  hasAnyPermission: (perms?: readonly string[] | null) => boolean
  hasAllPermissions: (perms?: readonly string[] | null) => boolean
  // Resource-aware variant (issue #921): `hasPermissionOn('storage.upload', 'storage', 'connId:local')`.
  hasPermissionOn: (permission: string, resourceType: ClientResourceType, resourceId: string) => boolean
  refresh: () => void | Promise<void>
}

const RBACContext = createContext<RBACContextValue>({
  permissions: [],
  roles: [],
  isAdmin: false,
  scopeTypes: [],
  hiddenWidgets: [],
  loading: true,
  hasPermission: () => false,
  hasAnyPermission: () => false,
  hasAllPermissions: () => false,
  hasPermissionOn: () => false,
  refresh: () => {},
})

export function RBACProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { data: session, status } = useSession()

  // Reload permissions when the user or tenant changes, not when the session object is
  // re-created: SessionProvider refetches /api/auth/session every 60 s and on
  // every window focus, and each refetch used to drag a full
  // /api/v1/rbac/effective round trip behind it.
  const userId = session?.user?.id ?? session?.user?.email ?? null
  const tenantId = session?.user?.tenantId ?? 'default'
  const identityKey = JSON.stringify([userId, tenantId, status])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const [permissions, setPermissions] = useState<string[]>([])
  // Every (permission, scope) pair the user holds, for resource-aware checks.
  const [grants, setGrants] = useState<GrantDetail[]>([])
  const [roles, setRoles] = useState<EffectiveRole[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [scopeTypes, setScopeTypes] = useState<string[]>([])
  const [hiddenWidgets, setHiddenWidgets] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Charger les permissions de l'utilisateur
  const loadPermissions = useCallback(async () => {
    const requestId = ++requestSequence.current
    setLoading(true)
    setPermissions([])
    setGrants([])
    setRoles([])
    setIsAdmin(false)
    setScopeTypes([])
    setHiddenWidgets([])
    if (status !== 'authenticated' || !userId) {
      setPermissions([])
      setRoles([])
      setIsAdmin(false)
      setScopeTypes([])
      setHiddenWidgets([])
      setLoading(false)
      setLoadedKey(identityKey)

return
    }

    try {
      const res = await fetch('/api/v1/rbac/effective')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: { data?: EffectiveRbac } = await res.json()
      if (requestId !== requestSequence.current) return

      if (json.data) {
        setPermissions(json.data.permissions || [])
        setGrants(Array.isArray(json.data.permission_details) ? json.data.permission_details : [])
        setRoles(json.data.roles || [])
        setIsAdmin(json.data.is_super_admin || false)
        setScopeTypes(json.data.scope_types || [])
        setHiddenWidgets(json.data.hidden_widgets || [])
      }
    } catch (e) {
      if (requestId !== requestSequence.current) return
      console.error('Failed to load RBAC permissions:', e)
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false)
        setLoadedKey(identityKey)
      }
    }
  }, [userId, status, identityKey])

  useEffect(() => {
    void loadPermissions()
    return () => { requestSequence.current++ }
  }, [loadPermissions])

  const pending = loading || loadedKey !== identityKey || status === 'loading'
  const accessReady = !pending && status === 'authenticated'


  // Vérifier si l'utilisateur a une permission spécifique
  const hasPermission = useCallback((permission: string) => {
    if (!accessReady) return false
    if (isAdmin) return true

return permissions.includes(permission)
  }, [permissions, isAdmin, accessReady])

  // Vérifier si l'utilisateur a au moins une des permissions
  const hasAnyPermission = useCallback((perms?: readonly string[] | null) => {
    if (!accessReady) return false
    if (isAdmin) return true
    if (!perms || perms.length === 0) return true

return perms.some(p => permissions.includes(p))
  }, [permissions, isAdmin, accessReady])

  // Permission on ONE resource (issue #921): a storage-scoped grant only
  // answers for the storage it names, a connection grant for the whole
  // cluster, mirroring the server-side scopeMatches.
  const hasPermissionOn = useCallback((permission: string, resourceType: ClientResourceType, resourceId: string) => {
    if (!accessReady) return false
    if (isAdmin) return true

return hasGrantOn(grants, permission, resourceType, resourceId)
  }, [grants, isAdmin, accessReady])

  // Vérifier si l'utilisateur a toutes les permissions
  const hasAllPermissions = useCallback((perms?: readonly string[] | null) => {
    if (!accessReady) return false
    if (isAdmin) return true
    if (!perms || perms.length === 0) return true

return perms.every(p => permissions.includes(p))
  }, [permissions, isAdmin, accessReady])

  const value = useMemo<RBACContextValue>(() => ({
    permissions: accessReady ? permissions : [],
    roles: accessReady ? roles : [],
    isAdmin: accessReady && isAdmin,
    scopeTypes: accessReady ? scopeTypes : [],
    hiddenWidgets: accessReady ? hiddenWidgets : [],
    loading: pending,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasPermissionOn,
    refresh: loadPermissions,
  }), [accessReady, permissions, roles, isAdmin, scopeTypes, hiddenWidgets, pending, hasPermission, hasAnyPermission, hasAllPermissions, hasPermissionOn, loadPermissions])

  return (
    <RBACContext.Provider value={value}>
      {children}
    </RBACContext.Provider>
  )
}

export function useRBAC() {
  return useContext(RBACContext)
}

/**
 * Hook pour vérifier si un élément de menu doit être affiché
 * @param {string[]} requiredPermissions - Permissions requises (au moins une)
 */
export function useMenuPermission(requiredPermissions?: readonly string[] | null) {
  const { hasAnyPermission, loading } = useRBAC()

  if (loading) return true // Afficher pendant le chargement
  if (!requiredPermissions || requiredPermissions.length === 0) return true

  return hasAnyPermission(requiredPermissions)
}

export default RBACContext
