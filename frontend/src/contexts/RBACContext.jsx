'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

import { useSession } from 'next-auth/react'

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
  refresh: () => {},
})

export function RBACProvider({ children }) {
  const { data: session, status } = useSession()

  // Reload permissions when the user changes, not when the session object is
  // re-created: SessionProvider refetches /api/auth/session every 60 s and on
  // every window focus, and each refetch used to drag a full
  // /api/v1/rbac/effective round trip behind it.
  const userId = session?.user?.id ?? session?.user?.email ?? null
  const [permissions, setPermissions] = useState([])
  const [roles, setRoles] = useState([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [scopeTypes, setScopeTypes] = useState([])
  const [hiddenWidgets, setHiddenWidgets] = useState([])
  const [loading, setLoading] = useState(true)

  // Charger les permissions de l'utilisateur
  const loadPermissions = useCallback(async () => {
    if (status !== 'authenticated' || !userId) {
      setPermissions([])
      setRoles([])
      setIsAdmin(false)
      setScopeTypes([])
      setHiddenWidgets([])
      setLoading(false)

return
    }

    try {
      const res = await fetch('/api/v1/rbac/effective')
      const json = await res.json()

      if (json.data) {
        setPermissions(json.data.permissions || [])
        setRoles(json.data.roles || [])
        setIsAdmin(json.data.is_super_admin || false)
        setScopeTypes(json.data.scope_types || [])
        setHiddenWidgets(json.data.hidden_widgets || [])
      }
    } catch (e) {
      console.error('Failed to load RBAC permissions:', e)
    } finally {
      setLoading(false)
    }
  }, [userId, status])

  useEffect(() => {
    loadPermissions()
  }, [loadPermissions])

  // Vérifier si l'utilisateur a une permission spécifique
  const hasPermission = useCallback((permission) => {
    if (isAdmin) return true

return permissions.includes(permission)
  }, [permissions, isAdmin])

  // Vérifier si l'utilisateur a au moins une des permissions
  const hasAnyPermission = useCallback((perms) => {
    if (isAdmin) return true
    if (!perms || perms.length === 0) return true

return perms.some(p => permissions.includes(p))
  }, [permissions, isAdmin])

  // Vérifier si l'utilisateur a toutes les permissions
  const hasAllPermissions = useCallback((perms) => {
    if (isAdmin) return true
    if (!perms || perms.length === 0) return true

return perms.every(p => permissions.includes(p))
  }, [permissions, isAdmin])

  return (
    <RBACContext.Provider value={{
      permissions,
      roles,
      isAdmin,
      scopeTypes,
      hiddenWidgets,
      loading,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
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
