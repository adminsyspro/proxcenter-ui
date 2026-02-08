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
  loading: true,
  hasPermission: () => false,
  hasAnyPermission: () => false,
  hasAllPermissions: () => false,
  refresh: () => {},
})

export function RBACProvider({ children }) {
  const { data: session, status } = useSession()
  const [permissions, setPermissions] = useState([])
  const [roles, setRoles] = useState([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  // Charger les permissions de l'utilisateur
  const loadPermissions = useCallback(async () => {
    if (status !== 'authenticated' || !session?.user) {
      setPermissions([])
      setRoles([])
      setIsAdmin(false)
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
      }
    } catch (e) {
      console.error('Failed to load RBAC permissions:', e)
    } finally {
      setLoading(false)
    }
  }, [session, status])

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
  
  if (loading) return false // Hide during loading for security
  if (!requiredPermissions || requiredPermissions.length === 0) return true
  
  return hasAnyPermission(requiredPermissions)
}

export default RBACContext
