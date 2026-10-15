'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'

import { useSession } from 'next-auth/react'

import { hasGrantOn } from '@/lib/rbac/clientScope'

/**
 * Contexte RBAC pour gérer les permissions de l'utilisateur connecté
 */

const RBACContext = createContext({
  permissions: [],
  roles: [],
  isAdmin: false,
  scopeTypes: [],
  hiddenWidgets: [],
  loading: true,
  // Default stubs accept an argument so TypeScript consumers inferring the
  // context type (e.g. `rbac.hasPermission('connection.manage')`) don't trip
  // the "Expected 0 arguments" error. The real implementations below use the
  // permission argument.
  hasPermission: (_p) => false,
  hasAnyPermission: (_perms) => false,
  hasAllPermissions: (_perms) => false,
  // Resource-aware variant (issue #921): `hasPermissionOn('storage.upload', 'storage', 'connId:local')`.
  hasPermissionOn: (_p, _type, _id) => false,
  refresh: () => {},
})

export function RBACProvider({ children }) {
  const { data: session, status } = useSession()

  // Reload permissions when the user or tenant changes, not when the session object is
  // re-created: SessionProvider refetches /api/auth/session every 60 s and on
  // every window focus, and each refetch used to drag a full
  // /api/v1/rbac/effective round trip behind it.
  const userId = session?.user?.id ?? session?.user?.email ?? null
  const tenantId = session?.user?.tenantId ?? 'default'
  const identityKey = JSON.stringify([userId, tenantId, status])
  const [loadedKey, setLoadedKey] = useState(null)
  const requestSequence = useRef(0)
  const [permissions, setPermissions] = useState([])
  // Every (permission, scope) pair the user holds, for resource-aware checks.
  const [grants, setGrants] = useState([])
  const [roles, setRoles] = useState([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [scopeTypes, setScopeTypes] = useState([])
  const [hiddenWidgets, setHiddenWidgets] = useState([])
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
      const json = await res.json()
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
    loadPermissions()
    return () => { requestSequence.current++ }
  }, [loadPermissions])

  const pending = loading || loadedKey !== identityKey || status === 'loading'
  const accessReady = !pending && status === 'authenticated'


  // Vérifier si l'utilisateur a une permission spécifique
  const hasPermission = useCallback((permission) => {
    if (!accessReady) return false
    if (isAdmin) return true

return permissions.includes(permission)
  }, [permissions, isAdmin, accessReady])

  // Vérifier si l'utilisateur a au moins une des permissions
  const hasAnyPermission = useCallback((perms) => {
    if (!accessReady) return false
    if (isAdmin) return true
    if (!perms || perms.length === 0) return true

return perms.some(p => permissions.includes(p))
  }, [permissions, isAdmin, accessReady])

  // Permission on ONE resource (issue #921): a storage-scoped grant only
  // answers for the storage it names, a connection grant for the whole
  // cluster, mirroring the server-side scopeMatches.
  const hasPermissionOn = useCallback((permission, resourceType, resourceId) => {
    if (!accessReady) return false
    if (isAdmin) return true

return hasGrantOn(grants, permission, resourceType, resourceId)
  }, [grants, isAdmin, accessReady])

  // Vérifier si l'utilisateur a toutes les permissions
  const hasAllPermissions = useCallback((perms) => {
    if (!accessReady) return false
    if (isAdmin) return true
    if (!perms || perms.length === 0) return true

return perms.every(p => permissions.includes(p))
  }, [permissions, isAdmin, accessReady])

  return (
    <RBACContext.Provider value={{
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
    }}>
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
export function useMenuPermission(requiredPermissions) {
  const { hasAnyPermission, loading } = useRBAC()

  if (loading) return true // Afficher pendant le chargement
  if (!requiredPermissions || requiredPermissions.length === 0) return true

  return hasAnyPermission(requiredPermissions)
}

export default RBACContext
